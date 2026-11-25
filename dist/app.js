import { update } from './db.js';
import { exportArchive, importArchive } from './backup.js?v=14';
import { adminOverview, createCircle, enqueue, issueInvite, join, memberDirectory, membership, refreshMembership, revokeInvite, saveCircleProfile, setFollowing, synchronize } from './sync.js?v=14';
import { checkForUpdates, startUpdates } from './updates.js';
import { followsConversation, unreadFor } from './conversations.js?v=14';

const main = document.querySelector('main');
const dialog = document.querySelector('#layers');
const layer = document.querySelector('#layer-content');
const creator = document.querySelector('#create-dialog');
const status = document.querySelector('#status');
const importInput = document.querySelector('#import');
const install = document.querySelector('#install');
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const lenses = ['Vivência', 'Outro ponto de vista', 'Referência', 'Pergunta', 'Síntese'];
const tags = items => items.length ? `<ul class="tags">${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '';
let data;
let view = 'feed';
let index = 0;
let selected;
let screen;
let filter = '';
let notice;
let installPrompt;
let syncSummary = '';
let activeOperations = 0;
let pendingWrites = 0;

function notify(message) {
  status.textContent = message;
  clearTimeout(notice);
  if (message) notice = setTimeout(() => { status.textContent = ''; }, 5500);
}

function author(id) {
  return data.users[id]?.name ?? 'Autor';
}

async function persist(change) {
  pendingWrites += 1;
  try { data = await update(state => { change(state); return state; }); }
  finally { pendingWrites -= 1; }
}

let people = [];
let relationships = [];
let viewedMember;
let profileTab = 'members';

function identity(id) {
  const user = data.users[id];
  const label = [author(id), user?.handle].filter(Boolean).map(escape).join(' · ');
  return user ? `<button type="button" class="identity" data-action="view-member" data-id="${escape(id)}">${label}</button>` : label;
}

function avatar(user, large = false) {
  const initials = (user.name || '?').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  return `<span class="avatar ${large ? 'avatar-large' : ''}" aria-hidden="true">${/^(?:data:image\/(?:jpeg|png|webp|gif|avif);base64,|assets\/photo-\d+\.jpg$)/.test(user.avatar ?? '')
    ? `<img src="${escape(user.avatar)}" alt="">` : escape(initials)}</span>`;
}

function profilePeople() {
  const account = membership();
  return account ? people : [];
}

function profile() {
  const user = data.users[data.currentUserId];
  const account = membership();
  const list = profilePeople().filter(person => person.id !== account?.id);
  const following = list.filter(person => person.followedByMe);
  const followers = list.filter(person => account
    ? relationships.some(relation => relation.follower === person.id && relation.followed === account.id)
    : (user.followers ?? []).includes(person.id));
  const person = viewedMember && (list.find(item => item.id === viewedMember) ?? data.users[viewedMember]);
  if (person) {
    return `<section class="page"><button class="quiet" data-action="own-profile">Voltar ao meu perfil</button>
      <div class="panel profile-summary">${avatar(person, true)}<div><h1>${escape(person.name)}</h1>
      <p class="muted">${escape(person.handle)}</p><p>${escape(person.bio ?? '')}</p>
      ${Number.isInteger(person.followers) ? `<p class="muted">${person.followers} seguidores · ${person.following} seguindo</p>` : ''}
      ${list.some(item => item.id === person.id) ? followButton(person) : ''}</div></div></section>`;
  }
  const selectedList = profileTab === 'followers' ? followers : profileTab === 'following' ? following : list;
  return `<section class="page"><h1>Meu perfil</h1>
    <div class="panel profile-summary">
      <div id="profile-avatar">${avatar(user, true)}</div><div><strong>${escape(user.name)}</strong>
      <p class="muted">${escape(user.handle)}</p><p>${escape(user.bio ?? '')}</p></div>
    </div>
    <section class="panel"><h2>${account ? 'Pessoas do círculo' : 'Pessoas'}</h2>
      <div class="actions profile-tabs" aria-label="Listas de pessoas">
        ${[['members','Pessoas',list.length],['followers','Seguidores',followers.length],['following','Seguindo',following.length]].map(
          ([key,label,count]) => `<button class="chip" data-action="profile-tab" data-tab="${key}" aria-pressed="${profileTab === key}">${label} · ${count}</button>`
        ).join('')}
      </div>
      ${selectedList.length ? selectedList.map(person => `<div class="row entry person-row">
        <button class="person" data-action="view-member" data-id="${escape(person.id)}">${avatar(person)}
          <span><strong>${escape(person.name)}</strong><span class="muted">${escape(person.handle)}</span></span>
        </button>${followButton(person)}</div>`).join('') : '<p class="muted">Ainda não há pessoas nesta lista.</p>'}
    </section>
    <form id="profile-form" class="panel">
      <h2>Editar perfil</h2>
      <div class="fields">
        <label>Foto de perfil<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/avif"></label>
        ${user.avatar?.startsWith('data:image/') ? '<button type="button" class="quiet" data-action="remove-avatar">Remover foto</button>' : ''}
        <label>Nome<input name="name" required maxlength="70" value="${escape(user.name)}"></label>
        <label>Arroba<input name="handle" required maxlength="32" value="${escape(user.handle)}"></label>
        <label>Bio<textarea name="bio" maxlength="240">${escape(user.bio)}</textarea></label>
      </div>
      <div class="actions form-foot"><button class="primary" type="submit">Salvar perfil</button></div>
    </form></section>`;
}

function followButton(person) {
  return `<button class="quiet" data-action="follow" data-id="${escape(person.id)}"
    aria-pressed="${Boolean(person.followedByMe)}" aria-label="${person.followedByMe ? 'Deixar de seguir' : 'Seguir'} ${escape(person.name)}">${person.followedByMe ? 'Seguindo' : 'Seguir'}</button>`;
}

async function loadPeople() {
  if (!membership() || !navigator.onLine) return;
  const directory = await memberDirectory();
  people = directory.members;
  relationships = directory.relationships;
}

function mediaMarkup(media) {
  if (!media) return '';
  const tag = media.kind;
  return `<figure class="attachment"><figcaption>${tag === 'audio' ? 'Áudio' : 'Vídeo'} · ${escape(media.name)}</figcaption>
    <${tag} controls preload="none" ${tag === 'video' ? 'playsinline' : ''} src="${escape(media.url)}"></${tag}>
  </figure>`;
}

function circleStatus(id) {
  const operation = data.outbox?.find(item => item.id === id);
  return operation?.error ? `<span class="muted">${escape(operation.error)}</span>`
    : operation ? '<span class="muted">Aguardando envio</span>' : '';
}

let dashboard;
let newInvite;
let adminError;
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function inviteState(invite) {
  if (invite.used !== null) return 'Usado';
  if (invite.revoked !== null) return 'Revogado';
  return invite.expires * 1000 <= Date.now() ? 'Expirado' : 'Ativo';
}

function administration() {
  const metrics = dashboard?.metrics;
  const currentCircle = dashboard ? dashboard.circle : membership()?.circle;
  const displayName = currentCircle?.name ?? 'Círculo';
  return `<section class="page">
    <header class="section-head"><div><p class="eyebrow">${escape(displayName)}</p><h1>Administração</h1></div>
      <button class="quiet" data-view="circle">Voltar</button></header>
    ${adminError ? `<p role="alert" class="panel">${escape(adminError)}</p>` : ''}
    ${!currentCircle && dashboard ? `<section class="panel">
      <h2>Criar primeiro círculo</h2>
      <form id="create-circle-form" class="fields">
        <label>Nome do círculo<input name="name" required maxlength="70"></label>
        <label>Descrição<textarea name="description" maxlength="320"></textarea></label>
        <div><button class="primary" type="submit">Criar círculo</button></div>
      </form>
    </section>` : ''}
    <section class="panel">
      <div class="row"><h2>Atividade do círculo</h2><button class="quiet" data-action="admin-refresh">Atualizar</button></div>
      ${metrics ? `<dl class="admin-metrics">${[
        ['Membros', metrics.members], ['Bolhas publicadas', metrics.bubbles], ['Ecos publicados', metrics.echoes],
        ['Pessoas que publicaram', metrics.authors], ['Relações de seguir', metrics.follows], ['Convites ativos', metrics.activeInvites],
      ].map(([label,value]) => `<div><dt>${label}</dt><dd>${value.toLocaleString('pt-BR')}</dd></div>`).join('')}</dl>`
        : '<p class="muted">As métricas precisam de conexão com o Dell.</p>'}
    </section>
    ${currentCircle ? `<section class="panel">
      <h2>Gerar convite</h2>
      <p class="muted">O código vale por 24 horas e permite uma entrada como membro.</p>
      <form id="invite-form" class="fields">
        <label>Identificação opcional<input name="label" maxlength="70"></label>
        <div><button class="primary" type="submit">Gerar convite</button></div>
      </form>
      ${newInvite ? `<div class="invite-result"><label>Código do convite<input id="generated-invite" readonly value="${escape(newInvite.code)}"></label>
        <button class="quiet" data-action="copy-invite">Copiar código</button>
        <p class="muted">Copie agora. O histórico registra o estado do convite.</p></div>` : ''}
    </section>
    <section class="panel"><h2>Convites recentes</h2>
      ${dashboard?.invites.length ? dashboard.invites.map(invite => `<div class="row entry admin-invite">
        <div><strong>${escape(invite.label || 'Convite')}</strong><span>${inviteState(invite)}</span>
          <span class="muted"> · Validade até ${dateTime.format(invite.expires * 1000)}</span></div>
        ${inviteState(invite) === 'Ativo' ? `<button class="quiet" data-action="revoke-invite" data-id="${escape(invite.id)}">Revogar</button>` : ''}
      </div>`).join('') : '<p class="muted">O histórico de convites aparecerá aqui.</p>'}
    </section>` : ''}
  </section>`;
}

async function loadAdministration() {
  try { dashboard = await adminOverview(); adminError = ''; }
  catch (error) { adminError = error.message; }
  if (view === 'admin') render();
}

function circle() {
  const member = membership();
  if (member) return `<section class="page"><h1>${escape(member.circle?.name ?? 'Círculo Expand')}</h1><div class="panel">
    ${member.circle?.description ? `<p class="muted">${escape(member.circle.description)}</p>` : ''}
    ${!member.circle ? '<p>O primeiro círculo ainda precisa ser criado.</p>' : ''}
    <p>${escape(member.name)} · ${escape(member.handle)}</p>
    <p class="muted">${(data.outbox ?? []).filter(item => !item.error).length} envios pendentes</p>
    <div class="actions"><button class="primary" data-action="sync-now">Sincronizar agora</button>
    ${member.admin ? '<button class="quiet" data-view="admin">Administração</button>' : ''}</div>
  </div></section>`;
  const user = data.users[data.currentUserId];
  return `<section class="page"><h1>Entrar no círculo</h1><form id="circle-form" class="panel">
    <div class="fields">
      <label>Código de convite<input name="invite" required maxlength="43" autocomplete="off" spellcheck="false"></label>
      <label>Nome<input name="name" required maxlength="70" value="${escape(user.name)}"></label>
      <label>Arroba<input name="handle" required maxlength="32" value="${escape(user.handle)}"></label>
    </div>
    <div class="actions form-foot"><button class="primary" type="submit">Entrar</button></div>
  </form></section>`;
}

async function refreshCircle(showStatus = false) {
  try {
    const changed = await synchronize();
    if (membership() && navigator.onLine) setSyncSummary('Última consulta ao Dell em ' + dateTime.format(new Date()) + '.');
    else setSyncSummary('Sem conexão. Os envios ficam no aparelho.');
    if (changed) {
      const id = view === 'feed' ? data.bubbles[index]?.id : null;
      data = await update();
      if (id && index > 0) index = Math.max(0, data.bubbles.findIndex(item => item.id === id));
      if (dialog.open) echoListNeedsRefresh = true;
      if (dialog.open && !layer.contains(document.activeElement?.form)) {
        const top = dialog.scrollTop;
        layerView();
        dialog.scrollTop = top;
      } else if (!dialog.open && !creator.open && view !== 'profile' && view !== 'admin' && view !== 'settings') render();
      if (view === 'settings') {
        const queue = document.querySelector('#settings-queue');
        const pending = (data.outbox ?? []).filter(item => !item.error).length;
        const failed = (data.outbox ?? []).filter(item => item.error).length;
        if (queue) queue.textContent = `${pending} ${pending === 1 ? 'envio aguardando' : 'envios aguardando'}${failed ? ` · ${failed} com falha` : ''}`;
      }
    }
    if (showStatus) notify(navigator.onLine ? 'Sincronização concluída.' : 'Sem conexão. Os envios ficam no aparelho.');
  } catch (error) { setSyncSummary(error.message); if (showStatus) report(error); }
}

const echoCount = count => count === 1 ? '1 novo Eco' : `${count} novos Ecos`;

function newEchoes() {
  const list = data.bubbles.filter(bubble => unreadFor(data, bubble.id).length);
  return `<section class="page"><header class="section-head">
    <h1>Novos Ecos</h1><button class="quiet" data-view="feed">Voltar</button>
    </header><div class="panel">
    ${list.length ? list.map(bubble => `<div class="row entry">
      <div><strong>${escape(bubble.prompt)}</strong><span class="muted">${echoCount(unreadFor(data, bubble.id).length)}</span></div>
      <button class="quiet" data-action="expand" data-id="${escape(bubble.id)}">Ver Ecos</button>
    </div>`).join('') : '<p>Você está em dia. Novos Ecos das bolhas que você acompanha aparecem aqui.</p>'}
    </div></section>`;
}

function newEchoesButton() {
  const total = data.bubbles.reduce((sum, bubble) => sum + unreadFor(data, bubble.id).length, 0);
  return `<button class="quiet new-echoes" data-view="new-echoes">Novos Ecos${total ? ` <span class="echo-count">${total}</span>` : ''}</button>`;
}

function feed() {
  const bubble = data.bubbles[index];
  const heading = `<header class="section-head"><div><p class="eyebrow">Círculos</p><h1>Bolhas em foco</h1></div><div class="actions">
    ${membership() ? newEchoesButton() : ''}<button class="quiet" data-view="circle">Círculo Expand</button>
  </div></header>`;
  if (!bubble) return heading + `<section class="panel empty">
    <h2>Nenhuma bolha por aqui</h2><p>Crie uma bolha para começar seu acervo.</p>
    <button class="primary" data-view="create">Criar primeira bolha</button>
  </section>`;
  const saved = data.saved.includes(bubble.id);
  return heading + `
    <article class="hero">
      <div class="art">
        <span class="orbit orbit-outer" aria-hidden="true"></span>
        <span class="orbit orbit-inner" aria-hidden="true"></span>
        <span class="orb">${bubble.image ? `<img src="${escape(bubble.image)}" alt="">` : ''}</span>
      </div>
      <div class="hero-copy">
        <p class="eyebrow">${escape(bubble.theme)}</p>
        <h2>${escape(bubble.prompt)}</h2>
        <p class="by">${identity(bubble.authorId)} · ${bubble.echoes.length} ${bubble.echoes.length === 1 ? 'Eco' : 'Ecos'}${bubble.shared ? ' · Círculo' : ''}</p>
        <div class="actions">
          <button class="primary" data-action="expand" data-id="${escape(bubble.id)}">Expandir</button>
          ${unreadFor(data, bubble.id).length ? `<span class="badge unread-badge">${echoCount(unreadFor(data, bubble.id).length)}</span>` : ''}
          <button class="quiet" data-action="save" data-id="${escape(bubble.id)}" aria-pressed="${saved}">${saved ? 'Salva' : 'Salvar'}</button>
        </div>
        ${tags(bubble.hashtags)}
      </div>
    </article>
    <div class="pager">
      <button class="quiet" data-action="previous" ${index === 0 ? 'disabled' : ''}>Anterior</button>
      <span>Bolha ${index + 1} de ${data.bubbles.length}</span>
      <button class="quiet" data-action="next" ${index + 1 === data.bubbles.length ? 'disabled' : ''}>Próxima</button>
    </div>`;
}

function setSyncSummary(message) {
  syncSummary = message;
  const output = document.querySelector('#settings-sync-status');
  if (output) output.textContent = message;
}

function settings() {
  const member = membership();
  const currentTheme = document.documentElement.dataset.themeChoice;
  const reduced = document.documentElement.dataset.motion === 'reduce';
  const installAvailable = Boolean(installPrompt);
  const pending = (data.outbox ?? []).filter(item => !item.error).length;
  const failed = (data.outbox ?? []).filter(item => item.error).length;
  return `<section class="page settings-page">
    <h1>Configurações</h1>
    <section class="panel" aria-labelledby="settings-account">
      <h2 id="settings-account">Perfil e círculo</h2>
      <p>${member ? `Você entrou como <strong>${escape(member.handle)}</strong>${member.circle ? ` em <strong>${escape(member.circle.name)}</strong>` : ''}.`
        : 'Seu acervo já funciona neste aparelho. Para participar de um círculo, entre com um convite.'}</p>
      <div class="actions"><button class="quiet" data-view="profile">Editar perfil</button>
        <button class="quiet" data-view="circle">${member ? 'Abrir círculo' : 'Entrar com convite'}</button></div>
    </section>
    <section class="panel" aria-labelledby="settings-look">
      <h2 id="settings-look">Aparência e acessibilidade</h2>
      <div class="settings-options">
        <div class="stack"><label for="settings-theme">Tema</label><select id="settings-theme">
          ${[['system','Usar tema do sistema'], ['light','Claro'], ['dark','Escuro']].map(([key,label]) =>
            `<option value="${key}" ${currentTheme === key ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <label class="setting-switch"><input type="checkbox" id="settings-motion" ${reduced ? 'checked' : ''}>
          <span>Reduzir movimento <small>Pausa os efeitos da bolha. O Expand também respeita a preferência do sistema.</small></span></label>
      </div>
    </section>
    <section class="panel" aria-labelledby="settings-notices">
      <h2 id="settings-notices">Avisos dentro do Expand</h2>
      <label class="setting-switch"><input type="checkbox" id="settings-notices-toggle" ${data.echoNotifications !== false ? 'checked' : ''}>
        <span>Avisar sobre novos Ecos <small>Registra novos avisos nas conversas acompanhadas após sincronizar. Para silenciar só uma conversa, abra a bolha e toque em Parar de acompanhar.</small></span></label>
      ${member ? '<button class="quiet" data-view="new-echoes">Abrir Novos Ecos</button>' : ''}
    </section>
    <section class="panel" aria-labelledby="settings-storage">
      <h2 id="settings-storage">Sincronização e acervo</h2>
      <p id="settings-sync-status" class="muted" role="status">${escape(member ? syncSummary || 'O Expand sincroniza quando está aberto e conectado.' : 'Seu conteúdo fica neste aparelho até você entrar e escolher publicar.')}</p>
      ${member ? `<p id="settings-queue">${pending} ${pending === 1 ? 'envio aguardando' : 'envios aguardando'}${failed ? ` · ${failed} com falha` : ''}</p>` : ''}
      <div class="actions">
        ${member ? '<button class="quiet" data-action="sync-now">Sincronizar agora</button>' : ''}
        <button class="primary" data-action="export">Exportar acervo</button>
        <button class="quiet" data-action="import">Restaurar acervo</button>
      </div>
      <p class="muted">O ZIP guarda seus textos e anexos locais. Restaurar substitui o acervo deste navegador depois da sua confirmação.</p>
    </section>
    <section class="panel" aria-labelledby="settings-update">
      <h2 id="settings-update">Atualizações do app</h2>
      <p id="settings-update-status" class="muted" role="status">O Expand verifica atualizações quando está aberto e conectado.</p>
      <button class="quiet" data-action="check-update">Verificar atualização</button>
    </section>
    <section class="panel" aria-labelledby="settings-guide">
      <h2 id="settings-guide">Como usar o Expand</h2>
      <details><summary>O que é uma bolha?</summary>
        <p>Uma bolha é uma conversa em torno de uma pergunta. A entrada apresenta o tema. Em <strong>Expandir</strong>, você encontra os Ecos da conversa. Em <strong>Ler ensaio</strong>, encontra o texto mais longo, quando o autor o incluiu.</p>
        <p>Para criar uma, comece com uma pergunta aberta e específica. Você pode acrescentar um ensaio para dar contexto e salvar a bolha no aparelho até decidir publicar.</p></details>
      <details><summary>O que é um círculo?</summary>
        <p>Um círculo é o grupo privado de pessoas que podem ler e responder às bolhas publicadas ali. Cada círculo pode reunir várias conversas. Na versão atual, entra-se por convite. Ao tocar em <strong>Publicar texto no círculo</strong>, você compartilha o texto com os membros.</p></details>
      <details><summary>O que são Eco, lente e expansão?</summary>
        <p>Um <strong>Eco</strong> é sua contribuição à conversa. A <strong>lente</strong> indica como você contribui. Use <strong>Vivência</strong> para contar algo que aconteceu com você ou <strong>Referência</strong> para indicar uma leitura relevante. A <strong>expansão</strong> acontece quando a conversa ganha perspectivas e permite voltar à pergunta com mais contexto.</p></details>
      <details><summary>Como aproveitar melhor o Expand?</summary>
        <ol>
          <li><strong>Escolha uma pergunta que importe para você.</strong> Abra a bolha, leia os Ecos e, se houver, o ensaio antes de responder.</li>
          <li><strong>Acrescente algo concreto.</strong> Numa bolha sobre soberania digital, por exemplo, conte como você recuperou suas fotos depois de perder acesso a uma conta e o que faria hoje para preservar essas lembranças.</li>
          <li><strong>Volte quando a conversa crescer.</strong> Use <strong>Acompanhar conversa</strong> para receber avisos em <strong>Novos Ecos</strong>. Use <strong>Salvar</strong> para encontrar a bolha depois na Biblioteca.</li>
        </ol></details>
      <details><summary>Entrar e instalar</summary><p>Abra Círculo Expand e cole o convite. Cada código vale por 24 horas e pode ser usado uma vez. No iPhone, abra o site no Safari, toque em Compartilhar e escolha Adicionar à Tela de Início. No Android ou no computador, procure Instalar app no menu do navegador.</p>
      ${installAvailable ? '<button class="quiet" data-action="install-app">Instalar Expand</button>' : ''}</details>
      <details><summary>Escrever offline e publicar</summary><p>Use Criar para salvar uma bolha no aparelho. Depois abra Expandir e escolha Publicar texto no círculo. Se estiver offline, o texto fica na fila. Na próxima conexão, mantenha o app aberto até o envio ser confirmado.</p></details>
      <details><summary>Quem vê cada coisa</summary><p>Rascunhos, leituras salvas e as mídias que você adiciona ficam no aparelho. O Dell guarda os textos publicados, o perfil compartilhado, relações de seguir e permissões do círculo. Imagens, avatares, áudios e vídeos ainda ficam disponíveis apenas no aparelho em que foram adicionados. O Expand funciona sem GPS.</p></details>
      <details><summary>Trocar de aparelho ou recuperar dados</summary><p>Exporte o ZIP antes de trocar de aparelho ou limpar os dados do site. Na outra instalação, use Restaurar acervo. O ZIP leva o acervo pessoal. Para recuperar o acesso ao círculo em outro navegador, fale com o administrador. Nesta versão, a sessão permanece no aparelho que usou o convite.</p></details>
    </section>
  </section>`;
}

function library() {
  const list = data.bubbles.filter(bubble => data.saved.includes(bubble.id));
  return `<section class="page">
    <h1>Biblioteca</h1>
    <div class="panel"><h2>Bolhas salvas</h2>
      ${list.length ? list.map(bubble => `<div class="row entry">
        <div><strong>${escape(bubble.prompt)}</strong><span class="muted">${escape(bubble.theme)}</span></div>
        <button class="quiet" data-action="expand" data-id="${escape(bubble.id)}">Abrir</button>
      </div>`).join('') : '<p class="muted">As bolhas que você salvar aparecem aqui.</p>'}
    </div>
    <div class="panel"><h2>Seu acervo</h2>
      <div class="actions">
        <button class="primary" data-action="export">Exportar acervo</button>
        <button class="quiet" data-action="import">Restaurar acervo</button>
      </div>
    </div>
  </section>`;
}

function create() {
  const draft = data.draft;
  return `<section class="page">
    <h1 id="create-title">Criar bolha</h1>
    <form id="bubble-form" class="panel">
      <div class="fields">
        <label>Tema<input name="theme" required maxlength="70" value="${escape(draft.theme)}"></label>
        <label>Pergunta<textarea name="prompt" required maxlength="260">${escape(draft.prompt)}</textarea></label>
        <label>Hashtags<input name="hashtags" maxlength="160" placeholder="#arte #cotidiano" value="${escape(draft.hashtags)}"></label>
        <label>Ensaio <span class="muted">Opcional</span><textarea name="essay" maxlength="20000">${escape(draft.essay)}</textarea></label>
        <label>Capa <span class="muted">Opcional</span><input type="file" name="cover" accept="image/jpeg,image/png,image/webp,image/avif"></label>
        <div class="actions" id="cover-preview">${preview(draft.image)}</div>
        ${['audio', 'video'].map(kind => `<div class="stack">
          <label>${kind === 'audio' ? 'Áudio · até 90 s e 1 MB' : 'Vídeo · até 30 s e 5 MB'}
            <input name="${kind}" type="file" accept="${kind}/*"></label>
          <div id="preview-${kind}">${attachmentPreview(draft[kind], kind)}</div>
        </div>`).join('')}
      </div>
      <div class="row form-foot">
        <span class="muted" id="draft-state">Rascunho neste dispositivo</span>
        <div class="actions"><button class="quiet" type="button" data-action="cancel-create">Cancelar</button>
        <button class="primary" type="submit">Salvar bolha</button></div>
      </div>
    </form>
  </section>`;
}

function attachmentPreview(media, kind) {
  return media ? `${mediaMarkup(media)}<button class="quiet" type="button" data-action="remove-media" data-kind="${kind}">Remover ${kind === 'audio' ? 'áudio' : 'vídeo'}</button>` : '';
}

function preview(image) {
  return image ? `<img width="100" src="${escape(image)}" alt="Prévia da capa"><button class="quiet" type="button" data-action="remove-cover">Remover capa</button>` : '';
}

function render() {
  for (const button of document.querySelectorAll('nav [data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  main.innerHTML = view === 'library' ? library() : view === 'profile' ? profile() : view === 'circle' ? circle() : view === 'admin' ? administration() : view === 'new-echoes' ? newEchoes() : view === 'settings' ? settings() : feed();
}

function layerView() {
  const bubble = data.bubbles.find(item => item.id === selected);
  if (!bubble) return;
  const essay = screen === 'essay';
  const visible = bubble.echoes.filter(echo => !filter || echo.lens === filter);
  const draft = data.echoDrafts[bubble.id] ?? { text: '', lens: lenses[0] };
  const filters = ['', ...new Set(bubble.echoes.map(echo => echo.lens))];
  layer.innerHTML = `
    <header class="layer-head">
      <button class="quiet" data-action="${essay ? 'echoes' : 'essay'}">${essay ? 'Voltar aos Ecos' : 'Ler ensaio'}</button>
      <button class="quiet" data-action="close" autofocus>Fechar</button>
    </header>
    <div class="layer-body">
      <p class="eyebrow">${essay ? 'Ensaio' : 'Ecos'} · ${escape(bubble.theme)}</p>
      <h2 id="layer-title">${escape(bubble.prompt)}</h2>
      <p class="muted">${identity(bubble.authorId)}</p>
      ${membership()?.circle && bubble.authorId === data.currentUserId && !bubble.shared && !data.outbox?.some(item => item.id === bubble.id)
        ? '<div class="actions toolbar"><button class="quiet" data-action="publish">Publicar texto no círculo</button></div>' : ''}
      ${circleStatus(bubble.id)}
      ${!essay && bubble.shared && membership()
        ? `<button class="quiet" data-action="watch-conversation" aria-pressed="${followsConversation(data, bubble, membership().id)}">${followsConversation(data, bubble, membership().id) ? 'Parar de acompanhar' : 'Acompanhar conversa'}</button>` : ''}
      ${mediaMarkup(bubble.audio)}${mediaMarkup(bubble.video)}
      ${essay ? `<article class="essay">${bubble.essay.length
        ? bubble.essay.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')
        : '<p>Esta bolha ainda não tem ensaio.</p>'}</article>
        ${bubble.sources.length ? `<h3>Referências</h3><ul>${bubble.sources.map(source => `<li>${escape(source)}</li>`).join('')}</ul>` : ''}`
      : `<div class="actions toolbar" aria-label="Filtrar Ecos por lente">
          ${filters.map(lens => `<button class="chip" data-action="filter" data-value="${escape(lens)}" aria-pressed="${lens === filter}">${escape(lens || 'Todas as lentes')}</button>`).join('')}
        </div>
        ${visible.map(echo => `<article class="echo">
          <div class="row"><strong>${identity(echo.authorId)}</strong><span class="chip">${escape(echo.lens)}</span></div>
          <p>${escape(echo.text)}</p>
          ${circleStatus(echo.id)}
        </article>`).join('') || '<p class="muted">Ainda não há Ecos nesta seleção.</p>'}
        <form id="echo-form" class="panel">
          <div class="fields">
            <label>Lente<select name="lens">${lenses.map(lens => `<option ${lens === draft.lens ? 'selected' : ''}>${escape(lens)}</option>`).join('')}</select></label>
            <label>Escrever Eco<textarea name="text" required maxlength="1500">${escape(draft.text)}</textarea></label>
          </div>
          <div class="row form-foot"><span class="muted" id="draft-state">${bubble.shared && membership() ? 'Círculo Expand' : 'Visível neste dispositivo'}</span><button class="primary">${bubble.shared && membership() ? 'Publicar Eco' : 'Salvar Eco'}</button></div>
        </form>`}
    </div>`;
}

let echoListNeedsRefresh = false;
dialog.addEventListener('close', () => {
  if (!echoListNeedsRefresh) return;
  echoListNeedsRefresh = false;
  if (view === 'feed' || view === 'new-echoes') render();
});

function showLayer() {
  layerView();
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}

async function prepareCover(file, maxSide = 1200) {
  if (file.size > 25_000_000) throw new Error('Escolha uma imagem de até 25 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [.82, .65, .48, .30]) {
      const image = canvas.toDataURL('image/webp', quality);
      if (image.length <= 333_330) return image;
    }
    throw new Error('A capa ainda está acima de 250 KB. Tente uma imagem menor.');
  } finally {
    bitmap.close();
  }
}

async function prepareMedia(file, kind) {
  const limit = kind === 'audio' ? { bytes: 1_000_000, seconds: 90 } : { bytes: 5_000_000, seconds: 30 };
  if (file.size > limit.bytes) throw new Error(`Selecione um arquivo de até ${limit.bytes / 1_000_000} MB.`);
  if (!new RegExp(`^${kind}/[a-z0-9.+-]+$`, 'i').test(file.type)) throw new Error('Formato de mídia incompatível.');
  const player = document.createElement(kind);
  if (!player.canPlayType(file.type)) throw new Error('Este navegador não reproduz o formato selecionado.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const duration = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Não foi possível ler a duração.')), 8000);
      player.onloadedmetadata = () => { clearTimeout(timeout); resolve(player.duration); };
      player.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível abrir o arquivo.')); };
      player.preload = 'metadata';
      player.src = objectUrl;
    });
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('O arquivo precisa ter duração conhecida.');
    if (duration > limit.seconds) throw new Error(`O arquivo deve ter até ${limit.seconds} segundos.`);
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
    return { kind, name: file.name, url, duration };
  } finally {
    player.removeAttribute('src');
    player.load();
    URL.revokeObjectURL(objectUrl);
  }
}

let pendingFiles = 0;
const actions = {
  'install-app'() { install.click(); },
  async 'check-update'() {
    if (!navigator.onLine) { notify('Conecte-se para verificar atualizações.'); return; }
    await checkForUpdates();
    notify('Verificação de atualização concluída.');
  },
  'admin-refresh'() { return loadAdministration(); },
  async 'copy-invite'() {
    if (!newInvite) return;
    try {
      await navigator.clipboard.writeText(newInvite.code);
      notify('Código copiado.');
    } catch {
      document.querySelector('#generated-invite')?.select();
      notify('Código selecionado para copiar.');
    }
  },
  async 'revoke-invite'(button) {
    const id = button.dataset.id;
    button.disabled = true;
    try {
      await revokeInvite(id);
      if (newInvite?.id === id) newInvite = null;
      await loadAdministration();
      notify('Convite revogado.');
    } finally { button.disabled = false; }
  },
  'profile-tab'(button) {
    profileTab = button.dataset.tab;
    render();
    main.querySelector('[aria-pressed="true"]')?.focus();
  },
  'own-profile'() { viewedMember = null; render(); },
  async 'view-member'(button) {
    const id = button.dataset.id;
    viewedMember = (id === data.currentUserId || id === membership()?.id) ? null : id;
    if (dialog.open) dialog.close();
    view = 'profile';
    render();
    window.scrollTo(0, 0);
    await loadPeople();
    if (view === 'profile') render();
  },
  async follow(button) {
    const id = button.dataset.id;
    const following = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    try {
      if (membership()) {
        await setFollowing(id, following);
        await loadPeople();
      } else {
        await persist(state => {
          const user = state.users[state.currentUserId];
          user.following = following ? [...new Set([...(user.following ?? []), id])]
            : (user.following ?? []).filter(person => person !== id);
        });
      }
      if (view === 'profile') render();
    } finally { button.disabled = false; }
  },
  async 'remove-avatar'() {
    await persist(state => { delete state.users[state.currentUserId].avatar; });
    render();
  },
  async publish() {
    const id = selected;
    await persist(state => {
      const bubble = state.bubbles.find(item => item.id === id);
      if (!membership() || !bubble || bubble.authorId !== state.currentUserId ||
          bubble.shared || state.outbox?.some(item => item.id === id)) return;
      const { theme, prompt, essay, hashtags } = bubble;
      enqueue(state, { id, kind: 'bubble', content: { theme, prompt, essay, hashtags } });
    });
    layerView();
    await refreshCircle(true);
    if (selected === id && dialog.open && !layer.querySelector('textarea')?.value) layerView();
  },
  'sync-now'() { return refreshCircle(true); },
  'cancel-create'() { creator.close(); },
  async 'remove-media'(button) {
    const kind = button.dataset.kind;
    await persist(state => { delete state.draft[kind]; });
    creator.querySelector(`#preview-${kind}`)?.replaceChildren();
  },
  previous() { index = Math.max(0, index - 1); render(); },
  next() { index = Math.min(data.bubbles.length - 1, index + 1); render(); },
  async expand(button) {
    const id = button.dataset.id;
    selected = id;
    filter = '';
    screen = 'echoes';
    showLayer();
    if (unreadFor(data, id).length) {
      const seen = new Set(unreadFor(data, id));
      await persist(state => {
        state.unreadEchoes = { ...state.unreadEchoes, [id]: unreadFor(state, id).filter(echo => !seen.has(echo)) };
      });
      if (dialog.open) echoListNeedsRefresh = true;
      else if (view === 'feed' || view === 'new-echoes') render();
    }
  },
  async 'watch-conversation'(button) {
    const id = selected;
    const watching = button.getAttribute('aria-pressed') === 'true';
    await persist(state => {
      state.conversationPreferences = { ...state.conversationPreferences, [id]: !watching };
      if (watching && state.unreadEchoes) delete state.unreadEchoes[id];
    });
    button.setAttribute('aria-pressed', String(!watching));
    button.textContent = watching ? 'Acompanhar conversa' : 'Parar de acompanhar';
    echoListNeedsRefresh = true;
  },
  close() { dialog.close(); },
  essay() { screen = 'essay'; showLayer(); layer.querySelector('[data-action="echoes"]').focus(); },
  echoes() { screen = 'echoes'; showLayer(); layer.querySelector('[data-action="essay"]').focus(); },
  filter(button) {
    filter = button.dataset.value;
    layerView();
    layer.querySelector('[data-action="filter"][aria-pressed="true"]')?.focus();
  },
  async save(button) {
    const id = button.dataset.id;
    await persist(state => {
      state.saved = state.saved.includes(id) ? state.saved.filter(item => item !== id) : [...state.saved, id];
    });
    const saved = data.saved.includes(id);
    button.textContent = saved ? 'Salva' : 'Salvar';
    button.setAttribute('aria-pressed', saved);
    notify(saved ? 'Bolha salva na Biblioteca.' : 'Bolha removida da Biblioteca.');
  },
  async export() {
    const archive = await exportArchive(await update());
    const url = URL.createObjectURL(archive);
    const link = document.createElement('a');
    link.href = url;
    link.download = `expand-acervo-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify('Acervo exportado.');
  },
  import() { importInput.click(); },
  async 'remove-cover'() {
    await persist(state => { delete state.draft.image; });
    const cover = document.querySelector('#cover-preview');
    if (cover) cover.replaceChildren();
  },
};

function report(error) {
  console.error(error);
  const message = error?.message || 'Não foi possível concluir a operação.';
  notify(message);
  if (dialog.open) {
    const label = layer.querySelector('#draft-state');
    if (label) label.textContent = message;
  }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || !data) return;
  try {
    if (button.dataset.view === 'create') {
      creator.innerHTML = create();
      creator.querySelector('[type=submit]').disabled = pendingFiles > 0;
      creator.showModal();
    } else if (button.dataset.view) {
      view = button.dataset.view;
      if (view === 'admin' && !membership()?.admin) view = 'circle';
      if (view === 'admin') loadAdministration();
      if (view === 'circle' && membership()) {
        refreshMembership().then(() => { if (view === 'circle') render(); }).catch(report);
      }
      if (view === 'profile') viewedMember = null;
      render();
      if (view === 'profile' && membership()) {
        loadPeople().then(() => {
          if (view === 'profile' && !main.querySelector('form')?.contains(document.activeElement)) render();
        }).catch(report);
      }
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    } else if (Object.hasOwn(actions, button.dataset.action)) {
      activeOperations += 1;
      try { await actions[button.dataset.action](button); }
      finally { activeOperations -= 1; }
    }
  } catch (error) { report(error); }
});

document.addEventListener('input', async event => {
  const field = event.target;
  if (field.form && field.type !== 'file') field.form.dataset.modified = '';
  if (!field.form?.matches('#bubble-form, #echo-form') || !field.name || field.type === 'file') return;
  const label = field.form.querySelector('#draft-state');
  const value = field.value;
  const key = field.name;
  const id = selected;
  const bubbleForm = field.form.id === 'bubble-form';
  label.textContent = 'Salvando…';
  try {
    await persist(state => {
      if (bubbleForm) state.draft[key] = value;
      else {
        state.echoDrafts[id] ??= { lens: lenses[0], text: '' };
        state.echoDrafts[id][key] = value;
      }
    });
    label.textContent = 'Rascunho salvo no aparelho';
  } catch (error) { label.textContent = 'Falha ao salvar o rascunho'; report(error); }
});

document.addEventListener('change', async event => {
  const field = event.target;
  if (['settings-theme', 'settings-motion', 'settings-notices-toggle'].includes(field.id)) {
    if (field.id === 'settings-theme') document.dispatchEvent(new CustomEvent('expand:theme', { detail: field.value }));
    else if (field.id === 'settings-motion') document.dispatchEvent(new CustomEvent('expand:motion', { detail: field.checked ? 'reduce' : 'system' }));
    else {
      const enabled = field.checked;
      try { await persist(state => { state.echoNotifications = enabled; }); }
      catch (error) { field.checked = !enabled; report(error); }
    }
    return;
  }
  if (field.form?.id === 'profile-form' && field.name === 'avatar' && field.files[0]) {
    activeOperations += 1;
    try {
      const image = await prepareCover(field.files[0], 320);
      await persist(state => { state.users[state.currentUserId].avatar = image; });
      const target = document.querySelector('#profile-avatar');
      if (target) target.innerHTML = avatar(data.users[data.currentUserId], true);
      if (field.isConnected && !field.form.querySelector('[data-action="remove-avatar"]')) {
        field.parentElement.insertAdjacentHTML('afterend', '<button type="button" class="quiet" data-action="remove-avatar">Remover foto</button>');
      }
      notify('Foto salva neste dispositivo.');
    } catch (error) { report(error); }
    finally { field.value = ''; activeOperations -= 1; }
    return;
  }
  if (!field.form?.matches('#bubble-form') || field.type !== 'file' || !field.files[0]) return;
  const file = field.files[0];
  const kind = field.name;
  pendingFiles += 1;
  creator.querySelector('[type=submit]').disabled = true;
  field.disabled = true;
  try {
    if (kind === 'cover') {
      const image = await prepareCover(file);
      await persist(state => { state.draft.image = image; });
      creator.querySelector('#cover-preview').innerHTML = preview(image);
    } else {
      const media = await prepareMedia(file, kind);
      await persist(state => { state.draft[kind] = media; });
      creator.querySelector(`#preview-${kind}`).innerHTML = attachmentPreview(media, kind);
    }
  } catch (error) {
    report(error);
    creator.querySelector('#draft-state').textContent = error.message;
  } finally {
    pendingFiles -= 1;
    field.value = '';
    field.disabled = false;
    creator.querySelector('[type=submit]').disabled = pendingFiles > 0;
  }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  const submit = form.querySelector('[type=submit], button:not([type])');
  submit.disabled = true;
  activeOperations += 1;
  try {
    if (form.id === 'create-circle-form') {
      await createCircle({ name: values.get('name').trim(), description: values.get('description').trim() });
      await loadAdministration();
      notify('Círculo criado.');
    } else if (form.id === 'invite-form') {
      newInvite = await issueInvite(values.get('label'));
      await loadAdministration();
      notify('Convite gerado.');
    } else if (form.id === 'circle-form') {
      const handle = '@' + values.get('handle').trim().replace(/^@/, '').toLowerCase();
      const joined = await join({ name: values.get('name').trim(), handle, invite: values.get('invite').trim() });
      await persist(state => Object.assign(state.users[state.currentUserId], { name: joined.name, handle: joined.handle }));
      render();
      await refreshCircle(true);
    } else if (form.id === 'profile-form') {
      const name = values.get('name').trim();
      const handle = values.get('handle').trim().replace(/^@/, '').toLowerCase();
      if (!name || !/^[a-z0-9_.]{1,31}$/.test(handle)) {
        throw new Error('Informe um nome e use letras sem acento, números, ponto ou sublinhado na arroba.');
      }
      const bio = values.get('bio').trim();
      if (membership()) await saveCircleProfile({ name, handle: '@' + handle, bio });
      await persist(state => {
        const duplicate = Object.values(state.users).some(user =>
          user.id !== state.currentUserId && user.handle?.toLowerCase() === '@' + handle);
        if (duplicate && !membership()) throw new Error('Esta arroba já existe neste acervo.');
        Object.assign(state.users[state.currentUserId], { name, handle: '@' + handle, bio });
      });
      render();
      notify('Perfil salvo neste dispositivo.');
    } else if (form.id === 'bubble-form') {
      const theme = values.get('theme').trim();
      const prompt = values.get('prompt').trim();
      if (!theme || !prompt) throw new Error('Preencha o tema e a pergunta.');
      const hashtags = [...new Set(values.get('hashtags').toLowerCase().split(/[\s,]+/)
        .map(tag => tag.replace(/^#+/, '')).filter(Boolean).map(tag => '#' + tag))];
      await persist(state => {
        state.bubbles.unshift({
          id: crypto.randomUUID(), authorId: state.currentUserId, theme, prompt, hashtags,
          essay: values.get('essay').trim().split(/\n\s*\n/).filter(Boolean),
          image: state.draft.image ?? '', audio: state.draft.audio, video: state.draft.video, echoes: [], sources: [],
        });
        state.draft = {};
      });
      creator.close();
      index = 0;
      view = 'feed';
      render();
      notify('Bolha salva neste dispositivo.');
    } else {
      const text = values.get('text').trim();
      if (!text) throw new Error('Escreva o Eco antes de salvar.');
      const id = selected;
      await persist(state => {
        const bubble = state.bubbles.find(item => item.id === id);
        if (!bubble) throw new Error('A bolha não está mais neste acervo.');
        const echo = { id: crypto.randomUUID(), authorId: state.currentUserId, text, lens: values.get('lens') };
        bubble.echoes.push(echo);
        if (membership() && bubble.shared) {
          enqueue(state, { id: echo.id, kind: 'echo', parent: bubble.id, content: { text, lens: echo.lens } });
        }
        delete state.echoDrafts[id];
      });
      filter = '';
      render();
      layerView();
      layer.querySelector('#draft-state').textContent = 'Eco salvo no aparelho';
      await refreshCircle();
      if (selected === id && dialog.open && !layer.querySelector('textarea')?.value) layerView();
    }
    delete form.dataset.modified;
  } catch (error) { report(error); }
  finally { submit.disabled = false; activeOperations -= 1; }
});

importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  importInput.value = '';
  if (!file) return;
  activeOperations += 1;
  try {
    const restored = await importArchive(file);
    if (!window.confirm('Restaurar este backup e substituir o acervo deste dispositivo?')) return;
    data = await update(() => restored);
    index = 0;
    render();
    notify('Acervo restaurado.');
  } catch (error) { report(error); }
  finally { activeOperations -= 1; }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  install.hidden = false;
  if (view === 'settings') render();
});
install.addEventListener('click', async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  install.hidden = true;
});

try {
  data = await update();
  render();
  refreshCircle();
  window.addEventListener('online', () => refreshCircle());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCircle(); });
  setInterval(() => { if (!document.hidden) refreshCircle(); }, 10000);
} catch (error) {
  main.innerHTML = '<p class="panel">O Expand precisa acessar o armazenamento deste navegador. Reabra a página e tente de novo.</p>';
  report(error);
}

startUpdates(() => !creator.open && !dialog.open && pendingFiles === 0 &&
  pendingWrites === 0 && activeOperations === 0 && !main.querySelector('form[data-modified]'));
