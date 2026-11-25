import { zipSync, unzipSync, strToU8, strFromU8 } from './assets/fflate.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const texts = value => Array.isArray(value) ? value.filter(string) : [];
const validImage = value => string(value) &&
  /^data:image\/(jpeg|png|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(value);

function validMedia(item, kind) {
  const limit = kind === 'audio' ? { bytes: 1_000_000, seconds: 90 } : { bytes: 5_000_000, seconds: 30 };
  if (item?.kind !== kind || !string(item.name) || !string(item.url) ||
      !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > limit.seconds) return undefined;
  const match = item.url.match(new RegExp(`^data:${kind}/[a-z0-9.+-]+;base64,([a-z0-9+/]+={0,2})$`, 'i'));
  if (!match || match[1].length % 4 !== 0) return undefined;
  const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0;
  if (match[1].length * 3 / 4 - padding > limit.bytes) return undefined;
  return { kind, name: item.name, url: item.url, duration: item.duration };
}

export function validate(input) {
  if (input?.format === 'expand') {
    if (input.version !== 1) throw new Error('A versão deste backup ainda não é compatível.');
    input = input.data;
  }
  if (!object(input?.users) || !Array.isArray(input.bubbles) || !string(input.currentUserId)) {
    throw new Error('Selecione um backup válido do Expand.');
  }

  const users = Object.fromEntries(Object.entries(input.users)
    .filter(([, user]) => object(user) && string(user.name))
    .map(([id, user]) => [id, { id, name: user.name, handle: string(user.handle) ? user.handle : '', bio: string(user.bio) ? user.bio : '',
      avatar: validImage(user.avatar) ? user.avatar : undefined, followers: texts(user.followers), following: texts(user.following) }]));
  if (!Object.hasOwn(users, input.currentUserId)) throw new Error('O backup não contém um perfil válido.');
  const seen = new Set();
  const bubbles = input.bubbles.map(bubble => {
    if (!string(bubble?.id) || seen.has(bubble.id) || !Object.hasOwn(users, bubble.authorId) ||
        !string(bubble.theme) || !string(bubble.prompt)) throw new Error('O backup contém uma bolha inválida.');
    seen.add(bubble.id);
    return {
      id: bubble.id, authorId: bubble.authorId, theme: bubble.theme, prompt: bubble.prompt,
      image: validImage(bubble.image) ? bubble.image : '',
      audio: validMedia(bubble.audio, 'audio'), video: validMedia(bubble.video, 'video'),
      hashtags: texts(bubble.hashtags), essay: texts(bubble.essay), sources: texts(bubble.sources),
      echoes: Array.isArray(bubble.echoes) ? bubble.echoes.filter(echo => string(echo?.id)
        && Object.hasOwn(users, echo.authorId) && string(echo.lens) && string(echo.text)) : [],
    };
  });
  const draft = Object.fromEntries(['theme', 'prompt', 'essay', 'hashtags'].map(key =>
    [key, string(input.draft?.[key]) ? input.draft[key] : '']));
  draft.image = validImage(input.draft?.image) ? input.draft.image : '';
  for (const kind of ['audio', 'video']) draft[kind] = validMedia(input.draft?.[kind], kind);
  const echoDrafts = Object.fromEntries(Object.entries(input.echoDrafts ?? {}).filter(([id, item]) =>
    seen.has(id) && string(item?.text) && string(item.lens)));
  const legacySaved = input.bubbles.filter(bubble => bubble.reactions?.length).map(bubble => bubble.id);
  return {
    currentUserId: input.currentUserId, users, bubbles, draft, echoDrafts,
    saved: texts(input.saved ?? legacySaved).filter(id => seen.has(id)),
    echoNotifications: input.echoNotifications !== false,
    conversationPreferences: Object.fromEntries(Object.entries(input.conversationPreferences ?? {}).filter(
      ([id, value]) => seen.has(id) && typeof value === 'boolean')),
    unreadEchoes: Object.fromEntries(bubbles.map(bubble => [bubble.id,
      texts(Object.hasOwn(input.unreadEchoes ?? {}, bubble.id) ? input.unreadEchoes[bubble.id] : [])
        .filter(id => bubble.echoes.some(echo => echo.id === id))]).filter(([, ids]) => ids.length)),
  };
}

export async function exportArchive(data) {
  const entries = {};
  const snapshot = structuredClone(data);
  const localFiles = new Map();
  async function attach(url, name, kind) {
    let path = localFiles.get(url);
    if (path) return path;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Uma mídia do acervo não pôde ser incluída.');
    const blob = await response.blob();
    const extension = blob.type.split('/')[1] || 'jpeg';
    path = `midias/${name}-${kind}.${extension}`;
    entries[path] = new Uint8Array(await blob.arrayBuffer());
    localFiles.set(url, path);
    return path;
  }
  async function attachRecord(record, name) {
    if (validImage(record.image)) record.image = await attach(record.image, name, 'image');
    for (const kind of ['audio', 'video']) {
      const media = validMedia(record[kind], kind);
      if (media) record[kind].url = await attach(media.url, name, kind);
    }
  }
  for (const [index, bubble] of snapshot.bubbles.entries()) {
    const name = `bolha-${index + 1}`;
    await attachRecord(bubble, name);
    const echoes = bubble.echoes.map(echo => `> ${echo.text.replaceAll('\n', '\n> ')}\n\n${echo.lens} · ${data.users[echo.authorId]?.name ?? ''}`);
    entries[`textos/${name}.md`] = strToU8(
      [`# ${bubble.prompt}`, bubble.theme, bubble.image && `![Capa](../${bubble.image})`,
        bubble.audio && `[Áudio](../${bubble.audio.url})`, bubble.video && `[Vídeo](../${bubble.video.url})`,
        ...bubble.essay, ...(echoes.length ? ['## Ecos', ...echoes] : []),
        ...(bubble.sources.length ? ['## Referências', ...bubble.sources.map(source => `- ${source}`)] : [])]
        .filter(Boolean).join('\n\n') + '\n');
  }
  await attachRecord(snapshot.draft, 'rascunho');
  for (const [index, user] of Object.values(snapshot.users).entries()) {
    if (validImage(user.avatar)) user.avatar = await attach(user.avatar, `perfil-${index + 1}`, 'image');
  }
  entries['acervo.json'] = strToU8(JSON.stringify({ format: 'expand', version: 1, data: snapshot }, null, 2));
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export async function importArchive(file) {
  if (file.size > 50 * 1024 * 1024) throw new Error('O limite por arquivo de importação é de 50 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 80 || bytes[1] !== 75) return validate(JSON.parse(strFromU8(bytes)));
  let total = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    if (entry.name !== 'acervo.json' && !/^midias\/[a-z0-9-]+\.[a-z0-9.+-]+$/i.test(entry.name)) return false;
    total += entry.originalSize;
    if (total > 60 * 1024 * 1024) throw new Error('O conteúdo descompactado ultrapassa 60 MB.');
    return true;
  } });
  if (!entries['acervo.json']) throw new Error('O ZIP não contém o acervo do Expand.');
  const input = JSON.parse(strFromU8(entries['acervo.json']));
  const records = [...(Array.isArray(input.data?.bubbles) ? input.data.bubbles : []), input.data?.draft];
  function restore(path, kind) {
    if (!string(path) || !path.startsWith('midias/') || !Object.hasOwn(entries, path)) return path;
    const bytes = entries[path];
    let extension = path.split('/').at(-1).split('.').slice(1).join('.');
    if (extension === 'jpg') extension = 'jpeg';
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    }
    return `data:${kind}/${extension};base64,${btoa(binary)}`;
  }
  for (const record of records) {
    if (!object(record)) continue;
    record.image = restore(record.image, 'image');
    for (const kind of ['audio', 'video']) {
      if (object(record[kind])) record[kind].url = restore(record[kind].url, kind);
    }
  }
  for (const user of Object.values(input.data?.users ?? {})) {
    if (object(user)) user.avatar = restore(user.avatar, 'image');
  }
  return validate(input);
}
