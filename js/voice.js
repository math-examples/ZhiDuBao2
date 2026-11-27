// ===== js/voice.js =====
import { State } from './state.js';
import { getSynth } from './speech.js';

// ─── Lang helpers ───
function normalizeLang(lang) {
  return (lang || '').toLowerCase().replace(/_/g, '-').replace(/\s.*$/, '');
}

function getLangPrefix(lang) {
  return (lang || '').toLowerCase().split(/[-_]/)[0];
}

function getBrowserLang() {
  const preferred = (navigator.languages || []).filter(Boolean);
  if (preferred.length > 0) {
    const raw = preferred[0];
    return { full: normalizeLang(raw), prefix: getLangPrefix(raw) };
  }
  const raw = navigator.language || navigator.userLanguage || 'en-US';
  return { full: normalizeLang(raw), prefix: getLangPrefix(raw) };
}

function findBestVoice(voiceList, targetFull, targetPrefix) {
  if (!voiceList.length) return null;
  let best = voiceList.find(v => normalizeLang(v.lang) === targetFull);
  if (best) return best;
  best = voiceList.find(v => getLangPrefix(v.lang) === targetPrefix);
  if (best) return best;
  return null;
}

// ─── Voice loading ───
async function loadVoices(timeout = 3000) {
  const synth = getSynth();
  return new Promise((resolve) => {
    let list = synth.getVoices();
    if (list.length) return resolve(list);
    const done = () => {
      list = synth.getVoices();
      if (list.length) {
        synth.removeEventListener('voiceschanged', done);
        resolve(list);
      }
    };
    synth.addEventListener('voiceschanged', done);
    setTimeout(() => resolve(synth.getVoices()), timeout);
  });
}

// ─── Module-level state ───
let voiceSelectEl = null;
let logFn = null;
let restartPlaybackFn = null;

// ─── Public API ───

export async function initVoices(selectElement, logCallback, restartPlaybackCallback) {
  voiceSelectEl = selectElement;
  logFn = logCallback;
  restartPlaybackFn = restartPlaybackCallback;

  await fillVoiceList();

  // Retry logic for slow voice engines
  const synth = getSynth();
  if (typeof synth.onvoiceschanged !== 'undefined') {
    synth.onvoiceschanged = fillVoiceList;
  }
  [500, 1000, 2000, 3000, 5000].forEach((delay, i, arr) => {
    setTimeout(() => {
      if (!State.voices.length) fillVoiceList();
      else if (!State.autoSelectDone) autoSelectVoice();
      if (i === arr.length - 1 && !State.autoSelectDone) {
        setTimeout(() => {
          if (!State.autoSelectDone && State.voices.length) autoSelectVoice();
        }, 1000);
      }
    }, delay);
  });
}

export function setupVoiceSelectListener() {
  voiceSelectEl.addEventListener('change', () => {
    State.userHasPickedVoice = true;
    State.autoSelectDone = true;
    const v = State.voices[voiceSelectEl.value];
    if (v) {
      State.userSelectedVoiceRef = { name: v.name, lang: v.lang };
      logFn('🔊 ' + v.name + ' (' + v.lang + ')');
      filterVoiceListToLang(v.lang);
    }
    if (State.isPlaying && restartPlaybackFn) restartPlaybackFn();
  });
}

export function setupShowAllVoicesListener(showAllBtn) {
  showAllBtn.addEventListener('click', () => {
    showAllVoices();
    logFn('Showing all voices');
  });
}

export function switchVoiceWhilePlaying() {
  if (State.isPlaying && restartPlaybackFn) restartPlaybackFn();
}

export function getCurrentVoice() {
  if (!voiceSelectEl || !State.voices.length) return null;
  return State.voices[voiceSelectEl.value] || null;
}

// ─── Internal functions ───

async function fillVoiceList() {
  State.voices = await loadVoices();
  const previouslySelectedVoice = State.userSelectedVoiceRef
    ? State.voices.find(v => v.name === State.userSelectedVoiceRef.name && v.lang === State.userSelectedVoiceRef.lang)
    : null;

  voiceSelectEl.innerHTML = '';
  if (!State.voices.length) {
    voiceSelectEl.appendChild(new Option('No voices detected', ''));
    return;
  }

  State.voices.forEach((v, i) => {
    voiceSelectEl.appendChild(new Option(
      `${v.name} (${v.lang})${v.localService ? '' : ' · Cloud'}`,
      i
    ));
  });

  if (!State.userHasPickedVoice && !State.autoSelectDone) {
    autoSelectVoice();
  } else if (previouslySelectedVoice) {
    const restoredIdx = State.voices.indexOf(previouslySelectedVoice);
    if (restoredIdx >= 0) {
      voiceSelectEl.value = restoredIdx;
      logFn('🔊 ' + previouslySelectedVoice.name + ' (' + previouslySelectedVoice.lang + ')');
    }
  }
}

function autoSelectVoice() {
  if (State.userHasPickedVoice || State.autoSelectDone) return;
  if (!State.voices.length) return;
  const { full, prefix } = getBrowserLang();
  const best = findBestVoice(State.voices, full, prefix);
  if (best) {
    State.autoSelectDone = true;
    voiceSelectEl.value = State.voices.indexOf(best);
    State.userSelectedVoiceRef = { name: best.name, lang: best.lang };
    logFn('🔊 ' + best.name + ' (' + best.lang + ')');
    filterVoiceListToLang(best.lang);
  } else {
    State.autoSelectRetries++;
    if (State.autoSelectRetries < State.MAX_AUTO_RETRIES) {
      setTimeout(autoSelectVoice, Math.min(300 * State.autoSelectRetries, 2000));
    } else {
      const enVoice = State.voices.find(v => getLangPrefix(v.lang) === 'en') || State.voices[0];
      if (enVoice) {
        State.autoSelectDone = true;
        voiceSelectEl.value = State.voices.indexOf(enVoice);
        State.userSelectedVoiceRef = { name: enVoice.name, lang: enVoice.lang };
        logFn('🔊 ' + enVoice.name + ' (' + enVoice.lang + ')');
        filterVoiceListToLang(enVoice.lang);
      }
    }
  }
}

function filterVoiceListToLang(targetLang) {
  if (!targetLang || !State.voices.length) return;
  const prefix = getLangPrefix(targetLang);
  const matching = State.voices.filter(v => getLangPrefix(v.lang) === prefix);
  if (matching.length <= 1) return;
  const currentVoice = State.voices[voiceSelectEl.value];
  voiceSelectEl.innerHTML = '';
  matching.forEach(v => {
    voiceSelectEl.appendChild(new Option(
      `${v.name} (${v.lang})${v.localService ? '' : ' · Cloud'}`,
      State.voices.indexOf(v)
    ));
  });
  if (currentVoice) {
    const stillThere = matching.findIndex(v => v.name === currentVoice.name && v.lang === currentVoice.lang);
    if (stillThere >= 0) {
      voiceSelectEl.value = State.voices.indexOf(currentVoice);
      logFn('🔊 ' + currentVoice.name + ' (' + currentVoice.lang + ')');
    }
  }
}

function showAllVoices() {
  if (!State.voices.length) return;
  const currentVoice = State.voices[voiceSelectEl.value];
  voiceSelectEl.innerHTML = '';
  State.voices.forEach((v, i) => {
    voiceSelectEl.appendChild(new Option(
      `${v.name} (${v.lang})${v.localService ? '' : ' · Cloud'}`,
      i
    ));
  });
  if (currentVoice) {
    const idx = State.voices.findIndex(v => v.name === currentVoice.name && v.lang === currentVoice.lang);
    if (idx >= 0) {
      voiceSelectEl.value = idx;
      logFn('🔊 ' + currentVoice.name + ' (' + currentVoice.lang + ')');
    }
  }
}