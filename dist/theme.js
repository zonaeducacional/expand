(() => {
  const key = 'expand-theme';
  const motionKey = 'expand-motion';
  const preference = matchMedia('(prefers-color-scheme: dark)');
  let choice;
  try { choice = localStorage.getItem(key); } catch {}
  if (choice !== 'light' && choice !== 'dark') choice = null;

  function applyTheme() {
    const theme = choice ?? (preference.matches ? 'dark' : 'light');
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeChoice = choice ?? 'system';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#1c1720' : '#f7f3ea';
    const selector = document.querySelector('#settings-theme');
    if (selector) selector.value = choice ?? 'system';
    const toggle = document.querySelector('#theme');
    if (!toggle) return;
    const label = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    toggle.firstElementChild.textContent = dark ? '☀' : '☾';
  }

  function setTheme(value) {
    choice = ['light', 'dark'].includes(value) ? value : null;
    try {
      if (choice) localStorage.setItem(key, choice);
      else localStorage.removeItem(key);
    } catch {}
    applyTheme();
  }

  function setMotion(value) {
    const reduced = value === 'reduce';
    document.documentElement.dataset.motion = reduced ? 'reduce' : 'system';
    try { localStorage.setItem(motionKey, reduced ? 'reduce' : 'system'); } catch {}
  }

  applyTheme();
  try {
    if (localStorage.getItem(motionKey) === 'reduce') document.documentElement.dataset.motion = 'reduce';
  } catch {}
  document.addEventListener('expand:theme', event => setTheme(event.detail));
  document.addEventListener('expand:motion', event => setMotion(event.detail));
  preference.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    document.querySelector('#theme').addEventListener('click', () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  });
})();
