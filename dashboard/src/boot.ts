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
hud.hooks.onCommand = (text) => void source.sendCommand(text);
source.start();
setInterval(paint, 15_000); // "4 min ago" / "in 3 h 06 min" keep moving without new data
