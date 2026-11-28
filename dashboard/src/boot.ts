import '@fontsource/michroma/400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-ext-500.css';
import '@fontsource/chakra-petch/vietnamese-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-ext-600.css';
import '@fontsource/chakra-petch/vietnamese-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/chakra-petch/latin-ext-700.css';
import '@fontsource/chakra-petch/vietnamese-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import '@fontsource/jetbrains-mono/vietnamese-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-ext-500.css';
import '@fontsource/jetbrains-mono/vietnamese-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-ext-700.css';
import '@fontsource/jetbrains-mono/vietnamese-700.css';
import './style.css';
import { createDataSource } from './data/datasource';
import { hud } from './hud';
import { Chat } from './ui/chat';
import { MIC_TEXT, PushToTalk, browserMicEnv, sttAvailable } from './ui/ptt';
import type { PttState } from './ui/ptt';
import { Voice } from './ui/speech';
import { SceneController } from './scene/controller';
import { capturePristine } from './scene/render';
import { startGeoShare } from './ui/geo';
import { bindQualityButton, renderCam, renderConn, renderHome, renderLocalAi, renderMic } from './ui/chrome';
import { LiveBinder } from './ui/live';

const source = createDataSource();
const binder = new LiveBinder(hud.api);
const controller = new SceneController({ hud: hud.api });

/** Keeps content below a header that wrapped onto more rows (narrow screens). */
function trackHeaderHeight(): void {
  const top = document.querySelector<HTMLElement>('.top');
  if (!top || typeof ResizeObserver === 'undefined') return;
  const set = () => document.documentElement.style.setProperty('--top-h', `${Math.ceil(top.getBoundingClientRect().bottom + 14)}px`);
  new ResizeObserver(set).observe(top);
  set();
}

let latest = source.getSnapshot();
const paint = () => {
  binder.render(latest);
  renderConn(latest);
  renderMic(latest);
  renderCam(latest);
  renderHome(latest);
  renderLocalAi(latest);
};
capturePristine(document, { setLog: () => {}, setVision: () => {} }); // remember the template's own text before any animation touches it
paint(); // first values go in before the intro animations read them (countUp targets)
hud.start();
trackHeaderHeight();
bindQualityButton(hud.api);

let core = latest.core;
source.subscribe((s) => {
  // the voice agent heard its wake word: show Listen; it heard nothing after all: back to Idle
  if (s.core !== core) {
    if (s.core === 'listening' && hud.api.getMode() === 'idle') {
      const tr = document.querySelector<HTMLElement>('#transcript');
      if (tr) {
        tr.dataset.text = ''; // not the template's sample sentence
        tr.textContent = '…';
      }
      hud.api.setMode('listen');
    } else if (core === 'listening' && s.core === 'idle' && hud.api.getMode() === 'listen') hud.api.setMode('idle');
    core = s.core;
  }
  latest = s;
  paint();
});
source.onScene((scene) => controller.handle(scene));

// talk to VEGA: type or speak, see the conversation, hear the answers
const input = document.querySelector<HTMLInputElement>('#q')!;
const chat = new Chat({ root: document.querySelector<HTMLElement>('#chat')!, input, send: (text) => source.sendCommand(text) });
const voice = new Voice();
let toldNoVoice = false;
const say = (text: string) =>
  void voice.speak(text).then((ok) => {
    if (ok || toldNoVoice) return;
    toldNoVoice = true;
    chat.note('No Vietnamese voice on this computer, so answers are not read aloud. Open VEGAS from the Pi (it speaks with its own voice), use Microsoft Edge, or add the Vietnamese voice in Windows Settings › Time & language › Speech.');
  });
source.onResult((id, text, extra) => {
  // only answers to this screen's own commands are read aloud; a research answer reads its summary, not the sources
  if (chat.result(id, text, extra.sources)) say(extra.speak ?? text);
});
// reminders and the briefing: every open screen shows and reads them (nobody asked from a particular tab)
source.onAnnounce((text) => {
  chat.announce(text);
  say(text);
});
// what the voice agent (pc-agent) heard: shown here, read aloud by the agent on its own speaker
source.onVoiceCommand((id, text) => chat.heard(id, text));
hud.hooks.onCommand = (text) => void chat.submit(text);

const spk = document.querySelector<HTMLButtonElement>('#spkBtn')!;
const paintSpk = () => {
  spk.setAttribute('aria-pressed', String(voice.enabled));
  spk.setAttribute('aria-label', voice.canSpeak ? (voice.enabled ? 'Read answers aloud: on' : 'Read answers aloud: off') : 'Reading aloud is not supported in this browser');
};
spk.disabled = !voice.canSpeak;
spk.addEventListener('click', () => {
  voice.setEnabled(!voice.enabled);
  paintSpk();
});
paintSpk();

// talking: hold the mic (or Space in an empty box) and release, or tap once to start and once to send.
// The brain transcribes when it has a key (push-to-talk, ptt.ts); otherwise the browser's own recognition, if any.
const mic = document.querySelector<HTMLButtonElement>('#micBtn')!;
const transcript = document.querySelector<HTMLElement>('#transcript');
const showHeard = (text: string) => {
  if (!transcript) return;
  transcript.dataset.text = ''; // the Listen intro would otherwise type the template's sample sentence
  transcript.textContent = text;
};
const micLabel = (s: PttState | 'browser') =>
  mic.setAttribute('aria-label', s === 'recording' || s === 'browser' ? 'Listening: release (or tap) to send' : s === 'sending' ? 'Transcribing…' : s === 'starting' ? 'Opening the microphone…' : 'Talk: hold to speak');
micLabel('idle');
let serverStt = false;
void sttAvailable((...a) => fetch(...a)).then((on) => (serverStt = on));
const ptt = new PushToTalk(browserMicEnv(), {
  onState(s) {
    mic.classList.toggle('on', s === 'recording');
    mic.classList.toggle('busy', s === 'sending' || s === 'starting');
    micLabel(s);
    if (s === 'recording') {
      showHeard('');
      hud.api.setMode('listen');
    } else if (s === 'sending') showHeard('…');
    else if (s === 'idle' && hud.api.getMode() === 'listen') hud.api.setMode('idle');
  },
  onText(text) {
    showHeard(text);
    chat.submit(text);
  },
  onProblem: (p) => chat.note(MIC_TEXT[p]),
});
let heard = '';
const browserListen = () =>
  voice.listen({
    onText(text, final) {
      heard = text;
      input.value = text;
      showHeard(text);
      if (final) voice.stopListening();
    },
    onError(error) {
      if (error === 'no-speech' || error === 'aborted') return;
      chat.note(error === 'not-allowed' || error === 'service-not-allowed' ? MIC_TEXT.denied : `Voice input failed (${error}). It needs Chrome or Edge and an internet connection.`);
    },
    onEnd() {
      mic.classList.remove('on');
      micLabel('idle');
      if (hud.api.getMode() === 'listen') hud.api.setMode('idle');
      if (heard.trim()) {
        input.value = '';
        chat.submit(heard);
      }
      heard = '';
    },
  });
const talking = () => ptt.state !== 'idle' || voice.listening;
const beginTalk = () => {
  if (talking()) return;
  voice.stop(); // the mic must not hear VEGA's own voice
  if (serverStt) return void ptt.start();
  if (voice.canListen && browserListen()) {
    mic.classList.add('on');
    micLabel('browser');
    showHeard('');
    hud.api.setMode('listen');
    return;
  }
  chat.note(window.isSecureContext ? MIC_TEXT.off : MIC_TEXT.insecure);
};
const endTalk = () => {
  if (ptt.state !== 'idle') ptt.stop();
  else if (voice.listening) voice.stopListening();
};
let downAt = 0;
let latched = false; // a short tap keeps listening until the next tap
mic.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  if (talking()) return void ((latched = false), endTalk());
  mic.setPointerCapture?.(e.pointerId);
  downAt = performance.now();
  latched = false;
  beginTalk();
});
mic.addEventListener('pointerup', () => {
  if (!talking() || latched || !downAt) return;
  if (performance.now() - downAt < 350) latched = true;
  else endTalk();
  downAt = 0;
});
mic.addEventListener('pointercancel', () => {
  downAt = 0;
  endTalk();
});
// keyboard on the mic button (Enter / Space) and Enter in an empty box: tap behaviour
hud.hooks.onMic = () => {
  if (talking()) return endTalk();
  latched = true;
  beginTalk();
};
let spaceHeld = false;
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || spaceHeld) return;
  const t = e.target;
  if (!(t === document.body || (t === input && !input.value))) return;
  e.preventDefault();
  spaceHeld = true;
  latched = false;
  beginTalk();
});
document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !spaceHeld) return;
  spaceHeld = false;
  endTalk();
});
source.start();
setInterval(paint, 15_000); // "4 min ago" / "in 3 h 06 min" keep moving without new data

// installable app with an offline shell (M8, public/sw.js). Not in dev: Vite's modules must never come from a cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// on a phone, the page shares its position with the brain while open (M8, ui/geo.ts); never in SIM mode (no brain)
if (source.kind === 'mqtt') startGeoShare({ token: (window as unknown as { __VEGA__?: { consoleToken?: string } }).__VEGA__?.consoleToken });
