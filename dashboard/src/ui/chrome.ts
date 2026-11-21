import type { ConnState, Snapshot } from '../data/types';
import { PICKABLE, writeStoredQuality } from '../quality';
import type { Quality } from '../quality';
import type { HudApi } from '../hud';

export const CONN_LABEL: Record<ConnState, string> = {
  live: 'LIVE',
  reconnecting: 'RECONNECTING',
  offline: 'OFFLINE',
  sim: 'SIM',
};
const CONN_TITLE: Record<ConnState, string> = {
  live: 'Connected to the broker',
  reconnecting: 'Lost the broker, retrying. Showing the last known state',
  offline: 'Broker unreachable. Showing sample data',
  sim: 'Simulated data, no broker',
};

export function renderConn(s: Pick<Snapshot, 'conn'>, root: ParentNode = document): void {
  const chip = root.querySelector<HTMLElement>('#conn');
  const txt = root.querySelector<HTMLElement>('#connTxt');
  if (!chip || !txt) return;
  chip.dataset.state = s.conn;
  chip.title = CONN_TITLE[s.conn];
  txt.textContent = CONN_LABEL[s.conn];
}

/** Header chip of the Vision camera (M7): only when it is unplugged. */
export function renderCam(s: Pick<Snapshot, 'camera'>, root: ParentNode = document): void {
  const chip = root.querySelector<HTMLElement>('#camChip');
  if (chip) chip.hidden = s.camera !== false;
}

/** Header chip of the voice agent's microphone: hidden while it listens normally (or no agent runs). */
export function renderMic(s: Pick<Snapshot, 'mic'>, root: ParentNode = document): void {
  const chip = root.querySelector<HTMLElement>('#micChip');
  if (!chip) return;
  chip.hidden = s.mic !== 'off' && s.mic !== 'missing';
  chip.dataset.state = s.mic ?? '';
  chip.title = s.mic === 'missing' ? 'The voice agent has no microphone (unplugged?)' : 'Microphone closed by the hotkey (Ctrl+Alt+M opens it)';
  chip.querySelector('b')!.textContent = s.mic === 'missing' ? 'NO MIC' : 'MIC OFF';
}

export function nextTier(q: Quality): Quality {
  const i = PICKABLE.indexOf(q); // css (kiosk) -> full
  return PICKABLE[(i + 1) % PICKABLE.length]!;
}

export function renderQuality(q: Quality, auto: boolean, root: ParentNode = document): void {
  const btn = root.querySelector<HTMLButtonElement>('#qBtn');
  const txt = root.querySelector<HTMLElement>('#qTxt');
  if (!btn || !txt) return;
  txt.textContent = q.toUpperCase();
  btn.setAttribute('aria-label', `Render quality: ${q}${auto ? ' (set automatically)' : ''}. Activate to change`);
  btn.title = auto ? 'Lowered automatically because the display was slow. Click to change' : 'Render quality: full / lite. Click to change';
}

/** Manual change: remembered, then the page reloads so WebGL can be created (or not) from scratch. */
export function bindQualityButton(hud: Pick<HudApi, 'getQuality' | 'isAutoQuality' | 'onQuality'>, reload: () => void = () => location.reload()): void {
  const btn = document.querySelector<HTMLButtonElement>('#qBtn');
  if (!btn) return;
  let auto = false;
  renderQuality(hud.getQuality(), false);
  hud.onQuality((q) => {
    auto = true;
    renderQuality(q, auto);
  });
  btn.addEventListener('click', () => {
    writeStoredQuality(nextTier(hud.getQuality()));
    const url = new URL(location.href);
    if (url.searchParams.has('quality')) {
      url.searchParams.delete('quality'); // a manual choice beats the URL from now on
      history.replaceState(null, '', url);
    }
    reload();
  });
}
