// ===== js/gesture.js =====
import { State } from './state.js';
import { APP_CONFIG } from './config.js';
import { getSynth } from './speech.js';
import { getCurrentVoice } from './voice.js';
import { doStop } from './reader.js';

// ─── Module-level refs (set by initGesture) ───
let els = {};
let logFn = null;
let synth = null;

export function initGesture(elements, logCallback) {
  els = elements;
  logFn = logCallback;
  synth = getSynth();
}

// ─── Word-at-point detection ───
export function getWordAtPoint(element, x, y) {
  let range;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent;
  let offset = range.startOffset;
  const isCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u0e00-\u0e7f]/.test(text[offset] || '');
  let start, end;
  if (isCJK) { start = offset; end = offset + 1; }
  else {
    const wordBoundaries = /[\s,.\-!?;:，。！？；：、()（）[\]【】""''""'']/;
    start = offset; end = offset;
    while (start > 0 && !wordBoundaries.test(text[start - 1])) start--;
    while (end < text.length && !wordBoundaries.test(text[end])) end++;
  }
  const word = text.substring(start, end).trim();
  if (!word || word.length < 1) return null;
  return { word, node, start, end };
}

// ─── Speak a single word ───
export function speakWord(word) {
  if (State.wordUtterance) { synth.cancel(); State.wordUtterance = null; }
  if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  State.longPressFired = false;

  // Remove previous highlight
  if (State.wordHighlightMark && State.wordHighlightMark.parentNode) {
    const text = State.wordHighlightMark.textContent;
    const textNode = document.createTextNode(text);
    State.wordHighlightMark.parentNode.replaceChild(textNode, State.wordHighlightMark);
    State.wordHighlightMark = null;
  }

  // Clear selection
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();

  // Stop reader if playing
  if (State.isPlaying) doStop();

  const u = new SpeechSynthesisUtterance(word);
  const voice = getCurrentVoice();
  u.lang = voice ? voice.lang : 'en-US';
  u.rate = parseFloat(els.rateEl.value);
  u.pitch = parseFloat(els.pitchEl.value);
  if (voice) u.voice = voice;

  function cleanupHighlight() {
    if (State.wordHighlightMark && State.wordHighlightMark.parentNode) {
      const text = State.wordHighlightMark.textContent;
      const textNode = document.createTextNode(text);
      State.wordHighlightMark.parentNode.replaceChild(textNode, State.wordHighlightMark);
      State.wordHighlightMark = null;
    }
    State.wordUtterance = null;
  }

  u.onend = cleanupHighlight;
  u.onerror = (e) => {
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    cleanupHighlight();
  };

  synth.speak(u);
  State.wordUtterance = u;

  // Log + dictionary links
  els.logEl.querySelectorAll('.word-link').forEach(el => el.remove());
  logFn('🔊 ' + word);
  document.body.classList.remove('log-hidden');
  State.barVisible = true;

  const q = encodeURIComponent(word);
  const cambridgeWord = encodeURIComponent(word.trim().toLowerCase());
  const isSingleWord = /^[a-z]+$/i.test(word.trim());
  const linksData = [
    { icon: '🔍', label: 'Bing', url: 'https://cn.bing.com/dict/search?q=' + q },
    { icon: '🎓', label: 'Cambridge', url: isSingleWord
      ? 'https://dictionary.cambridge.org/dictionary/english/' + cambridgeWord
      : 'https://dictionary.cambridge.org/search/english/?q=' + cambridgeWord },
    { icon: '📖', label: '有道', url: 'https://dict.youdao.com/result?word=' + q + '&lang=en' }
  ];
  linksData.forEach(d => {
    const a = document.createElement('a');
    a.className = 'word-link';
    a.href = d.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.title = d.label;
    a.innerHTML = d.icon + ' <span class="link-text">' + d.label + '</span>';
    els.logEl.insertBefore(a, els.fsBtn);
  });
}

// ─── Long-press setup ───
export function setupLongPress(el) {
  function startLongPress(x, y, target) {
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
    State.longPressFired = false;

    // Warm up speech engine on first interaction (href mode needs explicit user gesture)
    if (!State.warmed && State.isHrefMode() && !State.fsEverClicked) {
      State.warmed = true;
      const w = new SpeechSynthesisUtterance(' ');
      w.volume = 0; w.rate = 10; w.pitch = 1;
      w.onend = () => { logFn('✅ 语音初始化完毕'); };
      w.onerror = (e) => { logFn('❌ 语音初始化失败 (' + e.error + ') — 请长按'); };
      synth.speak(w);
      return;
    }
    if (!State.warmed) {
      State.warmed = true;
      const w = new SpeechSynthesisUtterance(' ');
      w.volume = 0; w.rate = 10;
      synth.speak(w);
    }

    State.longPressTimer = setTimeout(() => {
      State.longPressFired = true;
      window.getSelection().removeAllRanges();
      const result = getWordAtPoint(target, x, y);
      if (result) {
        const textNode = result.node;
        const text = textNode.textContent;
        const before = text.substring(0, result.start);
        const word = text.substring(result.start, result.end);
        const after = text.substring(result.end);
        const parent = textNode.parentNode;
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        const mark = document.createElement('mark');
        mark.className = 'word-hl';
        mark.textContent = word;
        frag.appendChild(mark);
        if (after) frag.appendChild(document.createTextNode(after));
        parent.replaceChild(frag, textNode);
        State.wordHighlightMark = mark;
        speakWord(word);
      }
    }, APP_CONFIG.longPressDelay);
  }

  el.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.paragraph')) { e.preventDefault(); return false; }
  });
  el.addEventListener('touchstart', (e) => {
    if (e.target.closest('.paragraph')) {
      const touch = e.touches[0];
      startLongPress(touch.clientX, touch.clientY, e.target);
    }
  }, { passive: true });
  el.addEventListener('touchmove', () => {
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (State.longPressFired) e.preventDefault();
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  }, { passive: false });
  el.addEventListener('touchcancel', () => {
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  }, { passive: true });
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.paragraph')) startLongPress(e.clientX, e.clientY, e.target);
  });
  el.addEventListener('mousemove', () => {
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  }, { passive: true });
  el.addEventListener('mouseup', (e) => {
    if (State.longPressFired) e.preventDefault();
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  }, { passive: false });
  el.addEventListener('mouseleave', () => {
    if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  }, { passive: true });
}