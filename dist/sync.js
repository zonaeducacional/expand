import { update } from './db.js';
import { recordUnread } from './conversations.js?v=14';

const key = 'expand-circle-session';
const ownerKey = 'expand-circle-owner';
let session;
try { session = JSON.parse(localStorage.getItem(key)); } catch {}
let running;
export const membership = () => session;

async function request(path, { method = 'GET', body, token } = {}) {
  let response;
  try {
    response = await fetch('./api/' + path, {
      method, cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new Error('Servidor do círculo indisponível.'); }
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) {
    throw Object.assign(new Error(json?.error ?? 'Servidor do círculo indisponível.'), { status: response.status });
  }
  return json;
}

function rememberAccount(result) {
  const owner = localStorage.getItem(ownerKey) ?? session?.id;
  if (owner && result.id !== owner) {
    throw new Error('Este acervo está vinculado a outra conta. Use outro perfil de navegador.');
  }
  const { accessCode, ...account } = result;
  localStorage.setItem(ownerKey, account.id);
  localStorage.setItem(key, JSON.stringify(account));
  session = account;
  return { ...account, accessCode };
}

export async function join(values) {
  if (session || localStorage.getItem(ownerKey)) {
    throw new Error('Este acervo já está vinculado a uma conta. Use outro perfil de navegador para criar uma conta diferente.');
  }
  return rememberAccount(await request('join', { method: 'POST', body: { ...values, issueAccessCode: true } }));
}

export async function login(values) {
  return rememberAccount(await request('login', { method: 'POST', body: values }));
}

export async function generateAccessCode(replace) {
  const result = await request('access-code', { method: 'POST', body: { replace }, token: session.token });
  session = { ...session, hasAccessCode: true };
  localStorage.setItem(key, JSON.stringify(session));
  return result.accessCode;
}

export async function refreshMembership() {
  if (!session || !navigator.onLine) return;
  const current = session;
  const result = await request('session', { token: current.token });
  if (session !== current) return;
  session = { ...session, ...result };
  localStorage.setItem(key, JSON.stringify(session));
}

export function adminOverview() {
  return request('admin/', { token: session.token });
}

export async function createCircle(values) {
  const result = await request('admin/circle', { method: 'POST', body: values, token: session.token });
  session = { ...session, circle: result.circle };
  localStorage.setItem(key, JSON.stringify(session));
  return result.circle;
}

export function issueInvite(label) {
  return request('admin/invites', { method: 'POST', body: { label }, token: session.token });
}

export function revokeInvite(id) {
  return request('admin/invites/' + encodeURIComponent(id), { method: 'DELETE', token: session.token });
}

export function memberDirectory() {
  return request('members', { token: session.token });
}

export function setFollowing(id, following) {
  return request('follows/' + encodeURIComponent(id), { method: 'PUT', token: session.token, body: { following } });
}

export async function saveCircleProfile(profile) {
  const result = await request('profile', { method: 'PUT', token: session.token, body: profile });
  session = { ...session, ...result };
  localStorage.setItem(key, JSON.stringify(session));
}

export function enqueue(state, operation) {
  state.outbox ??= [];
  state.outbox.push(operation);
}

function apply(state, change, memberId) {
  const { id, kind, parent, content, authorId, name, handle } = change;
  state.users[authorId] = { ...state.users[authorId], id: authorId, name, handle };
  if (kind === 'bubble') {
    const bubble = state.bubbles.find(item => item.id === id);
    if (bubble) bubble.shared = true;
    else state.bubbles.unshift({ ...content, id, authorId, shared: true, image: '', echoes: [], sources: [] });
  } else {
    const bubble = state.bubbles.find(item => item.id === parent);
    if (!bubble) return;
    const echo = bubble.echoes.find(item => item.id === id);
    if (echo) echo.shared = true;
    else {
      recordUnread(state, bubble, change, memberId);
      bubble.echoes.push({ ...content, id, authorId, shared: true });
    }
  }
}

async function run() {
  const sessionAtStart = session;
  const token = sessionAtStart.token;
  let state = await update();
  let changed = false;
  for (const operation of state.outbox ?? []) {
    if (operation.error) continue;
    try {
      await request('sync', { method: 'POST', token, body: operation });
      await update(data => {
        const bubble = data.bubbles.find(item => item.id === (operation.parent ?? operation.id));
        const published = operation.kind === 'echo' ? bubble?.echoes.find(item => item.id === operation.id) : bubble;
        if (published) published.shared = true;
        data.outbox = (data.outbox ?? []).filter(item => item.id !== operation.id);
        return data;
      });
    } catch (error) {
      if (![409, 422].includes(error.status)) throw error;
      await update(data => {
        const queued = data.outbox?.find(item => item.id === operation.id);
        if (queued) queued.error = error.message;
        return data;
      });
    }
    changed = true;
  }
  let cursor = state.circleCursor ?? 0;
  let more;
  let firstPage = true;
  do {
    const result = await request('sync?cursor=' + cursor + (firstPage ? '&profiles=1' : ''), { token });
    firstPage = false;
    const profiles = (result.profiles ?? []).filter(profile =>
      profile.id !== sessionAtStart.id || session === sessionAtStart);
    const differs = (current, profile) => current?.name !== profile.name ||
      current?.handle !== profile.handle || (current?.bio ?? '') !== profile.bio;
    const ownProfile = profiles.find(profile => profile.id === sessionAtStart.id);
    const profilesChanged = profiles.some(profile => differs(state.users[profile.id], profile)) ||
      ownProfile && differs(state.users[state.currentUserId], ownProfile);
    if (result.items.length || profilesChanged) {
      state = await update(data => {
        for (const change of result.items) {
          if (change.seq > (data.circleCursor ?? 0)) apply(data, change, sessionAtStart.id);
        }
        for (const profile of profiles) {
          if (profile.id === sessionAtStart.id && session !== sessionAtStart) continue;
          data.users[profile.id] = { ...data.users[profile.id], ...profile };
          if (profile.id === sessionAtStart.id) {
            const local = data.users[data.currentUserId];
            Object.assign(local, { name: profile.name, handle: profile.handle, bio: profile.bio });
          }
        }
        data.circleCursor = Math.max(data.circleCursor ?? 0, result.cursor);
        return data;
      });
      changed = true;
    }
    if (ownProfile && session === sessionAtStart && differs(session, ownProfile)) {
      session = { ...session, ...ownProfile };
      localStorage.setItem(key, JSON.stringify(session));
    }
    cursor = result.cursor;
    more = result.more;
  } while (more);
  return changed;
}

export function synchronize() {
  if (!session || !navigator.onLine) return Promise.resolve(false);
  if (!running) running = run().finally(() => { running = null; });
  return running;
}
