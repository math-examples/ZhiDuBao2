// ===== js/fullscreen.js =====
import { State } from './state.js';

// ─── Module-level state ───
let els = {};
let fsActive = false;
let initialDistance = null;
let initialFontSize = 17;

// ─── Public API ───

export function initFullscreen(elements) {
  els = elements;

  // Scroll hide/show bar
  els.reader.addEventListener('scroll', onScroll, { passive: true });

  // Click to toggle bar
  document.addEventListener('click', onClick);

  // Pinch-to-zoom
  els.reader.addEventListener('touchstart', onTouchStart, { passive: true });
  els.reader.addEventListener('touchmove', onTouchMove, { passive: false });
  els.reader.addEventListener('touchend', onTouchEnd, { passive: true });

  // Fullscreen toggle button
  els.fsBtn.addEventListener('click', () => {
    if (fsActive) exitFullscreen();
    else enterFullscreen();
  });
}

export function enterFullscreen() {
  State.fsEverClicked = true;
  document.body.classList.add('fs-mode');
  document.body.style.overflow = 'hidden';
  els.fsIconExpand.style.display = 'none';
  els.fsIconClose.style.display = 'block';
  els.fsBtn.title = 'Exit Fullscreen (Esc)';
  fsActive = true;
  document.body.classList.remove('log-hidden');
  requestAnimationFrame(() => {
    els.reader.style.paddingTop = els.logEl.offsetHeight + 'px';
  });
  State.logResizeObserver = new ResizeObserver(() => {
    if (fsActive) els.reader.style.paddingTop = els.logEl.offsetHeight + 'px';
  });
  State.logResizeObserver.observe(els.logEl);
}

export function exitFullscreen() {
  document.body.classList.remove('fs-mode');
  document.body.style.overflow = '';
  els.fsIconExpand.style.display = 'block';
  els.fsIconClose.style.display = 'none';
  els.fsBtn.title = 'Toggle Fullscreen';
  fsActive = false;
  document.body.classList.remove('log-hidden');
  els.reader.style.paddingTop = '';
  if (State.logResizeObserver) {
    State.logResizeObserver.disconnect();
    State.logResizeObserver = null;
  }
}

export function isFullscreen() {
  return fsActive;
}

// ─── Internal handlers ───

function showBar() {
  if (!State.barVisible) {
    document.body.classList.remove('log-hidden');
    State.barVisible = true;
  }
  if (State.hideTimer) { clearTimeout(State.hideTimer); State.hideTimer = null; }
  if (fsActive && State.isPlaying) {
    State.hideTimer = setTimeout(() => {
      if (els.logTextEl.textContent.startsWith('🔊')) return;
      document.body.classList.add('log-hidden');
      State.barVisible = false;
    }, 3000);
  }
}

function hideBar() {
  State.lastScrollTop = els.reader.scrollTop;
  if (els.logTextEl.textContent.startsWith('🔊')) return;
  if (State.barVisible) {
    document.body.classList.add('log-hidden');
    State.barVisible = false;
  }
  if (State.hideTimer) { clearTimeout(State.hideTimer); State.hideTimer = null; }
}

function onScroll() {
  if (!fsActive) return;
  const st = els.reader.scrollTop;
  const maxScroll = els.reader.scrollHeight - els.reader.clientHeight;
  State.barVisible = !document.body.classList.contains('log-hidden');
  if (st <= 15 || st >= maxScroll - 15) {
    showBar();
    State.lastScrollTop = st;
    return;
  }
  if (st > State.lastScrollTop + 15) hideBar();
  else if (st < State.lastScrollTop - 15) showBar();
  State.lastScrollTop = st;
}

function onClick(e) {
  if (!fsActive) return;
  if (e.target.closest('#log')) return;
  State.lastScrollTop = els.reader.scrollTop;
  State.barVisible = !document.body.classList.contains('log-hidden');
  if (State.isPlaying) showBar();
  else {
    if (State.barVisible) {
      document.body.classList.add('log-hidden');
      State.barVisible = false;
    } else {
      document.body.classList.remove('log-hidden');
      State.barVisible = true;
    }
  }
}

function onTouchStart(e) {
  if (!fsActive) return;
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    initialDistance = Math.sqrt(dx * dx + dy * dy);
    const sample = els.reader.querySelector('.paragraph');
    if (sample) initialFontSize = parseFloat(getComputedStyle(sample).fontSize);
  }
}

function onTouchMove(e) {
  if (!fsActive || e.touches.length !== 2 || !initialDistance) return;
  e.preventDefault();
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const scale = dist / initialDistance;
  let newSize = initialFontSize * scale;
  newSize = Math.max(8, newSize);
  els.reader.querySelectorAll('.paragraph').forEach(p => {
    p.style.fontSize = newSize + 'px';
  });
}

function onTouchEnd() {
  initialDistance = null;
}