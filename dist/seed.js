export function seed() {
  return {
    currentUserId: 'u-me',
    users: { 'u-me': { id: 'u-me', name: 'Você', handle: '', bio: '' } },
    bubbles: [],
  };
}

const sampleUsers = new Set(['u-helena', 'u-caio', 'u-clara', 'u-sergio', 'u-fernanda']);
const sampleBubbles = new Set(['b-cidade', 'b-tempo', 'b-cinema', 'b-escuta', 'b-leitura']);
const samplePhoto = value => typeof value === 'string' &&
  (/^assets\/photo-\d+\.jpg$/.test(value) || value.startsWith('https://images.unsplash.com/'));

export function cleanAcervo(state) {
  const mine = state.users[state.currentUserId];
  if (!mine) return state;
  for (const id of sampleUsers) {
    if (id !== state.currentUserId) delete state.users[id];
  }
  if (samplePhoto(mine.avatar)) delete mine.avatar;
  if (mine.bio === 'Explorando novas ideias fora da minha bolha') mine.bio = '';
  for (const field of ['followers', 'following']) {
    if (Array.isArray(mine[field])) mine[field] = mine[field].filter(id => !sampleUsers.has(id));
  }
  state.saved = (state.saved ?? []).filter(id => !sampleBubbles.has(id));
  if (samplePhoto(state.draft?.image)) delete state.draft.image;
  const kept = [];
  for (const bubble of state.bubbles) {
    if (!sampleBubbles.has(bubble.id) && Object.hasOwn(state.users, bubble.authorId)) {
      if (samplePhoto(bubble.image)) bubble.image = '';
      kept.push(bubble);
      continue;
    }
    const draft = state.echoDrafts?.[bubble.id];
    const echoes = (bubble.echoes ?? []).filter(echo => echo.authorId === state.currentUserId);
    if (echoes.length || draft?.text?.trim()) {
      const id = crypto.randomUUID();
      kept.push({ id, authorId: state.currentUserId, theme: 'Arquivo pessoal',
        prompt: 'Meus Ecos recuperados', hashtags: [], essay: [], sources: [], image: '', echoes });
      if (draft?.text?.trim()) state.echoDrafts[id] = draft;
    }
    if (state.echoDrafts) delete state.echoDrafts[bubble.id];
  }
  state.bubbles = kept;
  return state;
}
