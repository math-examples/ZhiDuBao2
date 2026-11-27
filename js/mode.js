// ===== js/mode.js =====
import { State } from './state.js';

// ─── Module-level refs ───
let els = {};
let logFn = null;

export function initMode(elements, logCallback) {
  els = elements;
  logFn = logCallback;

  setupModeUI();
  renderModeSwitchLink();
}

// ─── Mode-based UI setup ───
function setupModeUI() {
  if (State.isHrefMode()) {
    if (els.mainButtons) els.mainButtons.style.display = 'none';
    if (els.editor) els.editor.classList.add('hidden');
    if (els.emptyState) els.emptyState.style.display = 'block';
    if (els.backBtn) els.backBtn.style.display = 'none';
    if (els.editToggleBtn) els.editToggleBtn.style.display = 'none';
    logFn('Ready. Loading from href…');
  } else if (State.isFileMode()) {
    els.pasteBtn.textContent = '📁 文件';
    if (els.editToggleBtn) els.editToggleBtn.style.display = 'none';
  } else {
    els.textEl.placeholder = 'Type or paste text here to read aloud…';
    logFn('Ready: paste text to read, or type and click Read.');
  }
}

// ─── Mode switch link (rendered inside About overlay) ───
function renderModeSwitchLink() {
  const el = document.getElementById('modeSwitchLink');
  if (!el) return;
  const url = new URL(window.location.href);
  url.searchParams.delete('href');
  const isFileMode = url.searchParams.get('file') === '1';
  if (isFileMode) {
    url.searchParams.delete('file');
    const paramsString = url.searchParams.toString();
    const clean = url.pathname + (paramsString ? '?' + paramsString : '');
    el.innerHTML = '<a href="' + clean + '" style="color:var(--primary);text-decoration:none;font-size:13px;opacity:0.8;">📋 改为粘贴文本</a>';
  } else {
    url.searchParams.set('file', '1');
    const paramsString = url.searchParams.toString();
    el.innerHTML = '<a href="' + url.pathname + (paramsString ? '?' + paramsString : '') + '" style="color:var(--primary);text-decoration:none;font-size:13px;opacity:0.8;">📁 从文件加载</a>';
  }
}

// ─── Public query helpers (in case other modules need mode info) ───
export function isHrefMode() {
  return State.isHrefMode();
}

export function isFileMode() {
  return State.isFileMode();
}