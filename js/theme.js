// ===== js/theme.js =====
const STORAGE_KEY = 'bg-i';
const THEME_COUNT = 5;
const ICONS = ['☀️', '📖', '🌗', '🌙', '⚫'];

let currentIndex = 0;
let btn = null;

function applyTheme(n) {
  const tn = n + 1; // 1-based theme variable names (--theme-1-bg, etc.)
  const root = document.documentElement;

  root.style.setProperty('--bg', `var(--theme-${tn}-bg)`);
  document.body.style.color = `var(--theme-${tn}-fg)`;
  root.style.colorScheme = (tn >= 3) ? 'dark' : 'light';

  root.style.setProperty(
    '--fs-btn-color',
    `color-mix(in srgb, var(--theme-${tn}-fg) 78%, transparent)`
  );

  if (btn) {
    btn.textContent = ICONS[n];
  }

  localStorage.setItem(STORAGE_KEY, n);
}

export function initTheme() {
  btn = document.getElementById('bgCycle');
  currentIndex = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  currentIndex = Math.max(0, Math.min(THEME_COUNT - 1, currentIndex)); // clamp

  applyTheme(currentIndex);

  if (btn) {
    btn.addEventListener('click', () => {
      currentIndex = (currentIndex + 1) % THEME_COUNT;
      applyTheme(currentIndex);
    });
  }
}

/** Exposed if other modules need to know the active theme index */
export function getCurrentThemeIndex() {
  return currentIndex;
}