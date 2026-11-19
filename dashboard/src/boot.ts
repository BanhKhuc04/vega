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
import { Voice } from './ui/speech';
import { SceneController } from './scene/controller';
import { capturePristine } from './scene/render';
import { bindQualityButton, renderConn } from './ui/chrome';
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
};
capturePristine(document, { setLog: () => {} }); // remember the template's own text before any animation touches it
paint(); // first values go in before the intro animations read them (countUp targets)
hud.start();
trackHeaderHeight();
bindQualityButton(hud.api);

source.subscribe((s) => {
  latest = s;
  paint();
});
source.onScene((scene) => controller.handle(scene));

// talk to VEGA: type or speak, see the conversation, hear the answers
const input = document.querySelector<HTMLInputElement>('#q')!;
const chat = new Chat({ root: document.querySelector<HTMLElement>('#chat')!, input, send: (text) => source.sendCommand(text) });
const voice = new Voice();
let toldNoVoice = false;
source.onResult((id, text) => {
  if (!chat.result(id, text)) return; // only answers to this screen's own commands are read aloud
  if (!voice.speak(text) && !toldNoVoice) {
    toldNoVoice = true;
    chat.note('No Vietnamese voice on this computer, so answers are not read aloud. Open VEGA in Microsoft Edge, or add the Vietnamese voice in Windows Settings › Time & language › Speech.');
  }
});
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

const mic = document.querySelector<HTMLButtonElement>('#micBtn')!;
if (!voice.canListen) {
  mic.disabled = true;
  mic.setAttribute('aria-label', 'Voice input is not supported in this browser (use Chrome or Edge)');
}
const transcript = document.querySelector<HTMLElement>('#transcript');
hud.hooks.onMic = () => {
  if (voice.listening) return voice.stopListening();
  let heard = '';
  const started = voice.listen({
    onText(text, final) {
      heard = text;
      input.value = text;
      if (transcript) transcript.textContent = text;
      if (final) voice.stopListening();
    },
    onError(error) {
      if (error === 'no-speech' || error === 'aborted') return;
      chat.note(
        error === 'not-allowed' || error === 'service-not-allowed'
          ? 'Microphone blocked: allow it for this page in the browser, then press the mic again.'
          : `Voice input failed (${error}). It needs Chrome or Edge and an internet connection.`,
      );
    },
    onEnd() {
      mic.classList.remove('on');
      if (hud.api.getMode() === 'listen') hud.api.setMode('idle');
      if (heard.trim()) {
        input.value = '';
        chat.submit(heard);
      }
    },
  });
  if (!started) return;
  mic.classList.add('on');
  if (transcript) {
    transcript.dataset.text = ''; // the Listen intro would otherwise type the template's sample sentence
    transcript.textContent = '';
  }
  hud.api.setMode('listen');
};
source.start();
setInterval(paint, 15_000); // "4 min ago" / "in 3 h 06 min" keep moving without new data
