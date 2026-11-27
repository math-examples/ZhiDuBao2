// ===== js/reader.js =====
import { State } from './state.js';
import { getSynth } from './speech.js';

// ─── Module-level DOM refs (set by initReader) ───
let els = {};
let logFn = null;

export function initReader(elements, logCallback) {
  els = elements;
  logFn = logCallback;
}

// ─── Stop playback ───
export function doStop() {
  State.runId++;
  const synth = getSynth();
  synth.cancel();
  if (State.speakTimer) { clearTimeout(State.speakTimer); State.speakTimer = null; }
  State.isPlaying = false;
  updateReaderToggleBtn();
  logFn('Stopped');
  logFn('');
  // Clear any word links in the log bar
  const logEl = els.logEl;
  if (logEl) logEl.querySelectorAll('.word-link').forEach(el => el.remove());
}

function updateReaderToggleBtn() {
  const btn = els.toggleReaderBtn;
  if (!btn) return;
  btn.textContent = State.isPlaying ? '■ Stop' : '▶ Read';
  btn.classList.toggle('stop-mode', State.isPlaying);
  btn.classList.toggle('secondary', !State.isPlaying);
}

// ─── Render text into reader ───
export function renderReader(text) {
  State.paragraphs = text.split(/\r?\n/).map(l => l);
  State.currentIndex = 0;
  if (els.emptyState) els.emptyState.style.display = 'none';
  if (els.reader) {
    els.reader.innerHTML = '';
    State.paragraphs.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'paragraph';
      if (p === '') {
        div.style.height = '1em';
        div.style.padding = '0';
        div.style.marginBottom = '0.3em';
        div.style.pointerEvents = 'none';
      } else {
        div.textContent = p;
      }
      div.addEventListener('click', (e) => {
        if (State.longPressFired) return;
        if (!State.isPlaying) return;
        if (State.paragraphs[i] === '') return;
        State.runId++;
        getSynth().cancel();
        let target = i;
        while (target < State.paragraphs.length && State.paragraphs[target] === '') target++;
        if (target >= State.paragraphs.length) target = i;
        State.currentIndex = target;
        speakFrom(target);
        logFn('▶ From: ' + State.paragraphs[target].substring(0, 30) + '…');
      });
      els.reader.appendChild(div);
    });
    els.reader.classList.add('active');
  }
  if (els.readerControls) els.readerControls.classList.add('active');
  updateReaderToggleBtn();
}

// ─── Highlight active paragraph & auto-scroll ───
function highlightParagraph(index) {
  if (!els.reader) return;
  const paras = els.reader.querySelectorAll('.paragraph');
  paras.forEach((p, i) => {
    p.classList.remove('active', 'spoken');
    if (i < index) p.classList.add('spoken');
    if (i === index) p.classList.add('active');
  });
  if (index < paras.length) {
    const target = paras[index];
    const scrollOffset = target.offsetTop - els.reader.offsetTop -
      (els.reader.clientHeight / 2) + (target.offsetHeight / 2);
    els.reader.scrollTop = Math.max(0, scrollOffset);
  }
}

// ─── Core playback loop ───
export function speakFrom(index) {
  if (!State.isPlaying) return;
  const logEl = els.logEl;
  if (logEl) logEl.querySelectorAll('.word-link').forEach(el => el.remove());
  logFn('');
  const myRun = ++State.runId;
  State.currentIndex = index;
  const synth = getSynth();

  function next() {
    if (myRun !== State.runId) return;
    while (State.currentIndex < State.paragraphs.length && State.paragraphs[State.currentIndex] === '') {
      State.currentIndex++;
    }
    if (State.currentIndex >= State.paragraphs.length) {
      const paras = els.reader ? els.reader.querySelectorAll('.paragraph') : [];
      paras.forEach(p => { p.classList.remove('active', 'spoken'); });
      State.currentIndex = 0;
      logFn('Repeating…');
      State.speakTimer = setTimeout(next, 1200);
      return;
    }
    highlightParagraph(State.currentIndex);
    const u = new SpeechSynthesisUtterance(State.paragraphs[State.currentIndex]);
    const voice = State.voices[els.voiceSelect ? els.voiceSelect.value : 0];
    u.lang = voice ? voice.lang : 'en-US';
    u.rate = parseFloat(els.rateEl ? els.rateEl.value : 1);
    u.pitch = parseFloat(els.pitchEl ? els.pitchEl.value : 1);
    if (voice) u.voice = voice;
    u.onend = () => {
      if (myRun !== State.runId) return;
      State.currentIndex++;
      next();
    };
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      if (myRun !== State.runId) return;
      State.isPlaying = false;
      updateReaderToggleBtn();
      logFn('Error: ' + e.error);
    };
    synth.speak(u);
  }
  next();
}

// ─── Editor ↔ Reader transitions ───
export function enterReaderFromEditor() {
  const text = els.textEl ? els.textEl.value : '';
  if (!text) { logFn('Please enter text to read'); return; }
  if (els.editor) els.editor.classList.add('hidden');
  if (els.mainButtons) els.mainButtons.style.display = 'none';
  renderReader(text);
}

export function exitToEditor() {
  const synth = getSynth();
  if (State.wordUtterance) { synth.cancel(); State.wordUtterance = null; }
  if (State.longPressTimer) { clearTimeout(State.longPressTimer); State.longPressTimer = null; }
  if (State.paragraphs.length > 0 && els.textEl) {
    els.textEl.value = State.paragraphs.join('\n');
  }
  if (els.editor) els.editor.classList.remove('hidden');
  if (els.mainButtons) els.mainButtons.style.display = 'flex';
  if (els.reader) els.reader.classList.remove('active');
  if (els.readerControls) els.readerControls.classList.remove('active');
  if (els.editToggleBtn) els.editToggleBtn.classList.remove('active');
  doStop();
  logFn('');
  const logEl = els.logEl;
  if (logEl) logEl.querySelectorAll('.word-link').forEach(el => el.remove());
}

// ─── Href mode ───
export function loadFromHref() {
  const href = State.urlParams.get('href');
  if (!href) return;
  logFn('Loading text from ' + href + ' …');
  fetch(href)
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    })
    .then(text => {
      renderReader(text);
      logFn('Loaded ' + text.length + ' chars. Long-press a word to hear it spoken.');
    })
    .catch(err => logFn('Failed to load: ' + err.message));
}

// ─── Utility ───
export function getTopVisibleParagraphIndex() {
  if (!els.reader) return 0;
  const paras = els.reader.querySelectorAll('.paragraph');
  if (!paras.length) return 0;
  for (let i = 0; i < paras.length; i++) {
    const rect = paras[i].getBoundingClientRect();
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.5) return i;
  }
  for (let i = 0; i < paras.length; i++) {
    if (paras[i].getBoundingClientRect().bottom > 0) return i;
  }
  return 0;
}

export function updateReaderBtnState() {
  updateReaderToggleBtn();
}