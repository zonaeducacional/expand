const pageRelease = document.querySelector('meta[name="expand-release"]').content;
const managed = /^[a-f0-9]{20}$/.test(pageRelease);
const notice = document.querySelector('#app-update');
let registration;
let checking;
let readyToReload = false;
let updateReady = false;
let canReload = () => false;
let activationRequested;

function renderStatus() {
  const message = readyToReload || updateReady
    ? canReload() ? 'Aplicando nova versão do Expand…' : 'Nova versão pronta. A atualização será aplicada quando você sair da edição.'
    : '';
  notice.hidden = !message;
  notice.textContent = message;
  const output = document.querySelector('#settings-update-status');
  if (output) output.textContent = message || (managed
    ? 'O Expand verifica atualizações quando está aberto e conectado.'
    : 'Esta é uma prévia local. As atualizações automáticas funcionam na versão hospedada.');
}

function applyWhenReady() {
  if (!readyToReload && !updateReady) return;
  renderStatus();
  if (document.hidden || !canReload()) return;
  if (readyToReload) {
    window.location.reload();
  } else if (registration?.waiting && activationRequested !== registration.waiting) {
    activationRequested = registration.waiting;
    activationRequested.postMessage('expand:activate');
  }
}

function watchRegistration() {
  if (registration.waiting) {
    updateReady = Boolean(navigator.serviceWorker.controller);
    applyWhenReady();
  }
}

function checkController() {
  if (!managed) return;
  const worker = navigator.serviceWorker.controller;
  if (!worker) return;
  const channel = new MessageChannel();
  const timeout = setTimeout(() => channel.port1.close(), 1000);
  channel.port1.onmessage = event => {
    clearTimeout(timeout);
    channel.port1.close();
    const release = event.data?.release;
    if (typeof release !== 'string') return;
    readyToReload = release !== pageRelease;
    if (!registration?.waiting) updateReady = false;
    renderStatus();
    applyWhenReady();
  };
  worker.postMessage('expand:release', [channel.port2]);
}

async function check() {
  if (!navigator.onLine) return;
  if (managed) {
    const response = await fetch('./api/version', { cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Não foi possível consultar a versão do Expand.');
    const { release } = await response.json();
    if (!/^[a-f0-9]{20}$/.test(release)) throw new Error('Versão inválida na resposta do servidor.');
    const target = new URL('./sw.js', location.href);
    target.searchParams.set('expand-release', release);
    const worker = registration?.installing ?? registration?.waiting ?? registration?.active;
    if (worker?.scriptURL !== target.href) {
      registration = await navigator.serviceWorker.register(target, { updateViaCache: 'none' });
      registration.addEventListener('updatefound', watchInstallation);
    }
  } else if (!registration) {
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    registration.addEventListener('updatefound', watchInstallation);
  } else {
    await registration.update();
  }
  watchInstallation();
  watchRegistration();
  checkController();
}

function watchInstallation() {
  registration?.installing?.addEventListener('statechange', watchRegistration);
}

export function checkForUpdates() {
  if (!('serviceWorker' in navigator)) return Promise.resolve();
  if (!checking) checking = check().finally(() => { checking = null; });
  return checking;
}

export function startUpdates(isSafe) {
  if (!('serviceWorker' in navigator)) return;
  canReload = isSafe;
  const refresh = () => checkForUpdates().catch(error => console.debug(error.message));
  navigator.serviceWorker.addEventListener('controllerchange', checkController);
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      applyWhenReady();
      refresh();
    }
  });
  setInterval(() => { if (!document.hidden) refresh(); }, 30_000);
  setInterval(applyWhenReady, 1000);
  checkController();
  refresh();
}
