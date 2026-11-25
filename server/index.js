import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { release, releaseHtml, releaseWorker } from './release.js';
import { db, hash, secret, now, memberId, transaction, createInvite } from './store.js';

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const statements = {
  invite: db.prepare('DELETE FROM invites WHERE hash=? AND expires>=?'),
  handle: db.prepare('SELECT 1 FROM members WHERE handle=?'),
  join: db.prepare('INSERT INTO members VALUES (?, ?, ?, ?)'),
  member: db.prepare(`SELECT id,name,handle,EXISTS
    (SELECT 1 FROM administrators WHERE member=members.id) AS admin FROM members
    WHERE id=coalesce((SELECT member FROM device_sessions WHERE token=?),
      (SELECT id FROM members WHERE token=?))`),
  change: db.prepare('SELECT id,member,kind,parent,content FROM changes WHERE id=?'),
  insert: db.prepare('INSERT INTO changes(id,kind,parent,member,content) VALUES (?,?,?,?,?)'),
  pull: db.prepare(`SELECT c.seq,c.id,c.kind,c.parent,c.content,m.id AS authorId,m.name,m.handle
    FROM changes c JOIN members m ON c.member=m.id WHERE c.seq>? ORDER BY c.seq LIMIT 101`),
};
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const list = (value, count, max) => Array.isArray(value) && value.length <= count && value.every(item => validText(item, max));
const replyError = (reply, code, error) => reply.code(code).send({ error });

const circle = db.prepare('SELECT name,description,created FROM circle WHERE id=1');
const setAccessKey = db.prepare(`INSERT INTO access_keys VALUES (?,?)
  ON CONFLICT(member) DO UPDATE SET hash=excluded.hash`);
const accessAccount = db.prepare(`SELECT m.id,m.name,m.handle,coalesce(b.bio,'') AS bio,
    EXISTS(SELECT 1 FROM administrators WHERE member=m.id) AS admin
  FROM access_keys k JOIN members m ON k.member=m.id
  LEFT JOIN member_bios b ON b.member=m.id WHERE k.hash=? AND m.handle=?`);
const addDevice = db.prepare('INSERT INTO device_sessions VALUES (?,?)');
const accessExists = db.prepare('SELECT 1 FROM access_keys WHERE member=?');

function startAccess(memberId) {
  const code = secret();
  setAccessKey.run(memberId, hash(code));
  return code;
}

app.get('/api/health', async () => ({ ok: true }));
app.post('/api/join', async (request, reply) => {
  const { invite, name, handle, issueAccessCode } = request.body ?? {};
  if (typeof invite !== 'string' || !tokenPattern.test(invite) || !validText(name, 70) ||
      typeof handle !== 'string' || !/^@[a-z0-9_.]{1,31}$/.test(handle)) {
    return replyError(reply, 400, 'Confira o código, o nome e a arroba.');
  }
  return transaction(() => {
    if (statements.handle.get(handle)) return replyError(reply, 409, 'Esta arroba já pertence ao círculo.');
    const issued = db.prepare('SELECT admin FROM invite_history WHERE hash=?').get(hash(invite));
    if (!issued?.admin && !circle.get()) return replyError(reply, 409, 'O círculo ainda precisa ser criado pelo administrador.');
    if (!statements.invite.run(hash(invite), now()).changes) return replyError(reply, 403, 'Convite inválido, expirado ou já usado.');
    const token = secret();
    const id = memberId();
    statements.join.run(id, hash(token), name.trim(), handle);
    const accessCode = issueAccessCode === true ? startAccess(id) : undefined;
    if (issued?.admin) db.prepare('INSERT INTO administrators VALUES (?)').run(id);
    db.prepare('UPDATE invite_history SET used=? WHERE hash=?').run(now(), hash(invite));
    return reply.header('Cache-Control', 'no-store').code(201).send({ token, id, name: name.trim(), handle, admin: Boolean(issued?.admin), circle: circle.get() ?? null, accessCode, hasAccessCode: Boolean(accessCode) });
  });
});

function member(request) {
  const token = request.headers.authorization?.slice(7);
  if (!request.headers.authorization?.startsWith('Bearer ') || !tokenPattern.test(token ?? '')) return;
  const digest = hash(token);
  return statements.member.get(digest, digest);
}

app.post('/api/login', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const { handle, accessCode } = request.body ?? {};
  const account = typeof handle === 'string' && typeof accessCode === 'string' && tokenPattern.test(accessCode)
    ? accessAccount.get(hash(accessCode), handle) : null;
  if (!account) return replyError(reply, 401, 'Confira a arroba e o código de acesso.');
  const token = secret();
  addDevice.run(hash(token), account.id);
  return { ...account, admin: Boolean(account.admin), circle: circle.get() ?? null, token, hasAccessCode: true };
});

app.post('/api/access-code', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const viewer = member(request);
  if (!viewer) return replyError(reply, 401, 'Entre no círculo para continuar.');
  const currentToken = hash(request.headers.authorization.slice(7));
  return transaction(() => {
    if (accessExists.get(viewer.id) && request.body?.replace !== true) {
      return replyError(reply, 409, 'Já existe um código. Reabra Configurações para confirmar a substituição.');
    }
    db.prepare('DELETE FROM device_sessions WHERE member=? AND token<>?').run(viewer.id, currentToken);
    db.prepare('UPDATE members SET token=? WHERE id=? AND token<>?').run(hash(secret()), viewer.id, currentToken);
    return { accessCode: startAccess(viewer.id) };
  });
});

app.get('/api/session', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const viewer = member(request);
  if (!viewer) return replyError(reply, 401, 'Entre no círculo para continuar.');
  return { ...viewer, admin: Boolean(viewer.admin), circle: circle.get() ?? null, hasAccessCode: Boolean(accessExists.get(viewer.id)) };
});

const overview = db.prepare(`SELECT
  (SELECT count(*) FROM members) AS members,
  (SELECT count(*) FROM changes WHERE kind='bubble') AS bubbles,
  (SELECT count(*) FROM changes WHERE kind='echo') AS echoes,
  (SELECT count(DISTINCT member) FROM changes) AS authors,
  (SELECT count(*) FROM follows) AS follows,
  (SELECT count(*) FROM invites WHERE expires >= ?) AS activeInvites`);
const publicProfiles = db.prepare(`SELECT m.id,m.name,m.handle,coalesce(b.bio,'') AS bio
  FROM members m LEFT JOIN member_bios b ON b.member=m.id`);
const recentInvites = db.prepare(`SELECT id,label,created,expires,used,revoked
  FROM invite_history WHERE admin=0 ORDER BY created DESC, rowid DESC LIMIT 30`);

app.register(async function administration(adminApp) {
  adminApp.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const viewer = member(request);
    if (!viewer) return replyError(reply, 401, 'Entre no círculo para continuar.');
    if (!viewer.admin) return replyError(reply, 403, 'Área exclusiva para administradores.');
  });

  adminApp.get('/', async () => ({ metrics: overview.get(now()), invites: recentInvites.all(), circle: circle.get() ?? null }));
  adminApp.post('/circle', async (request, reply) => {
    const { name, description = '' } = request.body ?? {};
    if (!validText(name, 70) || typeof description !== 'string' || description.length > 320) {
      return replyError(reply, 422, 'Informe um nome de até 70 caracteres e uma descrição de até 320.');
    }
    const result = db.prepare('INSERT OR IGNORE INTO circle VALUES (1,?,?,?)').run(name.trim(), description.trim(), now());
    if (!result.changes) return replyError(reply, 409, 'O primeiro círculo já foi criado.');
    return reply.code(201).send({ circle: circle.get() });
  });
  adminApp.post('/invites', async (request, reply) => {
    if (!circle.get()) return replyError(reply, 409, 'Crie o círculo antes de gerar convites.');
    const label = request.body?.label ?? '';
    if (typeof label !== 'string' || label.length > 70) return replyError(reply, 422, 'Use uma identificação de até 70 caracteres.');
    return reply.code(201).send(createInvite(label.trim()));
  });
  adminApp.delete('/invites/:id', async (request, reply) => transaction(() => {
    const invite = db.prepare('SELECT hash FROM invite_history WHERE id=? AND admin=0 AND used IS NULL AND revoked IS NULL AND expires>=?')
      .get(request.params.id, now());
    if (!invite) return replyError(reply, 404, 'Este convite já não está ativo.');
    db.prepare('DELETE FROM invites WHERE hash=?').run(invite.hash);
    db.prepare('UPDATE invite_history SET revoked=? WHERE id=?').run(now(), request.params.id);
    return { ok: true };
  }));
}, { prefix: '/api/admin' });

const directory = db.prepare(`SELECT m.id,m.name,m.handle,coalesce(b.bio,'') AS bio,
  (SELECT count(*) FROM follows WHERE followed=m.id) AS followers,
  (SELECT count(*) FROM follows WHERE follower=m.id) AS following,
  EXISTS(SELECT 1 FROM follows WHERE follower=? AND followed=m.id) AS followedByMe
  FROM members m LEFT JOIN member_bios b ON b.member=m.id ORDER BY m.handle`);
const relationships = db.prepare('SELECT follower,followed FROM follows WHERE follower=? OR followed=?');
const memberExists = db.prepare('SELECT 1 FROM members WHERE id=?');
const follow = db.prepare('INSERT OR IGNORE INTO follows VALUES (?,?)');
const unfollow = db.prepare('DELETE FROM follows WHERE follower=? AND followed=?');
const saveBio = db.prepare(`INSERT INTO member_bios VALUES (?,?)
  ON CONFLICT(member) DO UPDATE SET bio=excluded.bio`);

app.get('/api/members', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  const viewer = member(request);
  if (!viewer) return replyError(reply, 401, 'Acesso ao círculo necessário.');
  return { members: directory.all(viewer.id), relationships: relationships.all(viewer.id, viewer.id) };
});
app.put('/api/profile', async (request, reply) => {
  const viewer = member(request);
  if (!viewer) return replyError(reply, 401, 'Acesso ao círculo necessário.');
  const { name, handle, bio } = request.body ?? {};
  if (!validText(name, 70) || typeof handle !== 'string' || !/^@[a-z0-9_.]{1,31}$/.test(handle) ||
      typeof bio !== 'string' || bio.length > 240) return replyError(reply, 422, 'Confira os dados do perfil.');
  return transaction(() => {
    if (handle !== viewer.handle && statements.handle.get(handle)) return replyError(reply, 409, 'Esta arroba já pertence ao círculo.');
    db.prepare('UPDATE members SET name=?,handle=? WHERE id=?').run(name.trim(), handle, viewer.id);
    saveBio.run(viewer.id, bio.trim());
    return { id: viewer.id, name: name.trim(), handle, bio: bio.trim() };
  });
});
app.put('/api/follows/:id', async (request, reply) => {
  const viewer = member(request);
  if (!viewer) return replyError(reply, 401, 'Acesso ao círculo necessário.');
  const { id } = request.params;
  const { following } = request.body ?? {};
  if (id === viewer.id || !memberExists.get(id) || typeof following !== 'boolean') {
    return replyError(reply, 422, 'Selecione outro membro do círculo.');
  }
  (following ? follow : unfollow).run(viewer.id, id);
  return { following };
});

app.get('/api/sync', async (request, reply) => {
  reply.header('Cache-Control', 'no-store');
  if (!member(request)) return replyError(reply, 401, 'Acesso ao círculo necessário.');
  const cursor = Number(request.query.cursor ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) return replyError(reply, 400, 'Cursor inválido.');
  const rows = statements.pull.all(cursor);
  const items = rows.slice(0, 100).map(row => ({ ...row, content: JSON.parse(row.content) }));
  return { items, cursor: items.at(-1)?.seq ?? cursor, more: rows.length > 100,
    ...(request.query.profiles === '1' ? { profiles: publicProfiles.all() } : {}) };
});

app.post('/api/sync', async (request, reply) => {
  const author = member(request);
  if (!author) return replyError(reply, 401, 'Acesso ao círculo necessário.');
  if (!circle.get()) return replyError(reply, 409, 'O círculo ainda precisa ser criado.');
  const { id, kind, parent = null, content } = request.body ?? {};
  if (typeof id !== 'string' || !idPattern.test(id) || !content || typeof content !== 'object') {
    return replyError(reply, 422, 'Publicação inválida.');
  }
  let clean;
  if (kind === 'bubble' && parent === null && validText(content.theme, 70) && validText(content.prompt, 260) &&
      list(content.essay, 500, 20000) && content.essay.join('\n\n').length <= 20000 &&
      list(content.hashtags, 80, 160) && content.hashtags.join(' ').length <= 240) {
    const { theme, prompt, essay, hashtags } = content;
    clean = { theme, prompt, essay, hashtags };
  } else if (kind === 'echo' && typeof parent === 'string' && idPattern.test(parent) &&
      validText(content.text, 1500) && validText(content.lens, 70)) {
    const { text, lens } = content;
    clean = { text, lens };
  } else return replyError(reply, 422, 'O círculo aceita bolhas e Ecos de texto dentro dos limites do editor.');
  const serialized = JSON.stringify(clean);
  return transaction(() => {
    const existing = statements.change.get(id);
    if (existing) {
      if (existing.member !== author.id || existing.kind !== kind || existing.parent !== parent || existing.content !== serialized) {
        return replyError(reply, 409, 'Este identificador já pertence a outra publicação.');
      }
      return { id };
    }
    if (parent && statements.change.get(parent)?.kind !== 'bubble') return replyError(reply, 422, 'A bolha ainda não está no círculo.');
    statements.insert.run(id, kind, parent, author.id, serialized);
    return reply.code(201).send({ id });
  });
});

app.addHook('onRequest', async (request, reply) => {
  const expected = request.query?.['expand-release'];
  if (expected && expected !== release) {
    return reply.header('Cache-Control', 'no-store').code(409).send({ error: 'A versão em publicação mudou.' });
  }
});

app.get('/api/version', async (_request, reply) =>
  reply.header('Cache-Control', 'no-store').send({ release }));

for (const path of ['/', '/index.html']) {
  app.get(path, async (_request, reply) =>
    reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8').send(releaseHtml));
}
app.get('/sw.js', async (_request, reply) =>
  reply.header('Cache-Control', 'no-store').type('application/javascript; charset=utf-8').send(releaseWorker));

await app.register(staticFiles, {
  root: fileURLToPath(new URL('../dist/', import.meta.url)),
  cacheControl: false,
  setHeaders(response) { response.setHeader('Cache-Control', 'no-store'); },
});
await app.listen({ host: '0.0.0.0', port: 3060 });
