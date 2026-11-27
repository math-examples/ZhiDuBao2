import { APP_CONFIG } from './config.js';

export function getSynth() {
  return APP_CONFIG.synth;
}

export function createUtterance(text, options = {}) {
  const u = new SpeechSynthesisUtterance(text);
  u.volume = options.volume ?? 1;
  u.rate = options.rate ?? 1;
  u.pitch = options.pitch ?? 1;
  u.lang = options.lang ?? 'en-US';
  if (options.voice) u.voice = options.voice;
  return u;
}