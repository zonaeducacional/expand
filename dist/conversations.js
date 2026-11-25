export function followsConversation(state, bubble, memberId) {
  const preferences = state.conversationPreferences ?? {};
  if (Object.hasOwn(preferences, bubble.id)) return preferences[bubble.id];
  const own = id => id === state.currentUserId || id === memberId;
  return state.saved.includes(bubble.id) || own(bubble.authorId) || bubble.echoes.some(echo => own(echo.authorId));
}

export function unreadFor(state, id) {
  const unread = state.unreadEchoes ?? {};
  return Object.hasOwn(unread, id) ? unread[id] : [];
}

export function recordUnread(state, bubble, change, memberId) {
  if (state.echoNotifications === false || change.authorId === memberId || !followsConversation(state, bubble, memberId)) return;
  state.unreadEchoes = { ...state.unreadEchoes, [bubble.id]: [...new Set([...unreadFor(state, bubble.id), change.id])] };
}
