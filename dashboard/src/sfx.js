// Tiny Web Audio UI sounds. Browsers only allow audio after a user gesture; failures are silent.
let ctx = null, muted = false;
let gesture = false; // no AudioContext until the user has interacted (autoplay policy, and no console noise)
function ac() {
  if (!gesture) return null;
  if (!ctx) { const A = window.AudioContext || /** @type {any} */ (window).webkitAudioContext; if (A) ctx = new A(); }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function tone(freq, dur = 0.07, type = 'sine', vol = 0.035, slide = null, delay = 0) {
  if (muted) return;
  try {
    const c = ac(); if (!c || c.state !== 'running') return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}
const unlock = () => { gesture = true; ac(); };
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });
export const sfx = {
  hover: () => tone(1300, 0.025, 'sine', 0.01, 1650),
  click: () => tone(700, 0.05, 'triangle', 0.03, 1000),
  tick: (f = 950) => tone(f, 0.03, 'sine', 0.015),
  lock: () => { tone(880, 0.08, 'triangle', 0.035); tone(1320, 0.12, 'triangle', 0.03, null, 0.08); },
  mode(m) {
    if (m === 'alert') { tone(240, 0.22, 'sawtooth', 0.05, 130); tone(200, 0.28, 'sawtooth', 0.05, 105, 0.18); }
    else if (m === 'success') { tone(523.25, 0.12, 'triangle', 0.045); tone(659.25, 0.12, 'triangle', 0.045, null, 0.09); tone(783.99, 0.25, 'triangle', 0.05, null, 0.18); }
    else if (m === 'sleep') tone(420, 0.4, 'sine', 0.035, 160);
    else { tone(480, 0.07, 'sine', 0.03, 920); tone(1120, 0.08, 'triangle', 0.02, null, 0.055); }
  },
  toggle() { muted = !muted; return muted; }
};
