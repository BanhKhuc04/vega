/**
 * The Console (M8, brief 0013 B7–B8): what VEGA knows, in tables. Reads the brain's /api/*; its only two actions (cancel a
 * reminder, switch a device) are sent as ordinary commands through POST /api/command. Every value goes in as text.
 */
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/vietnamese-400.css';

const TABS = ['today', 'devices', 'reminders', 'memory', 'commands', 'costs', 'access'] as const;
type Tab = (typeof TABS)[number];

const token = (window as unknown as { __VEGA__?: { consoleToken?: string } }).__VEGA__?.consoleToken;
const view = document.querySelector<HTMLElement>('#view')!;
const msg = document.querySelector<HTMLElement>('#msg')!;

class ApiError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) } });
  } catch {
    throw new ApiError('VEGA is not reachable. Check that the Pi is on and you are on the tailnet.');
  }
  if (r.status === 401) throw new ApiError('The Console token is wrong. Run setup.sh again on the Pi, then reload.');
  if (r.status === 503) throw new ApiError('The Console is off: set CONSOLE_TOKEN in infra/pi/.env (setup.sh does it), then restart the stack.');
  if (r.status === 502 || r.status === 504) throw new ApiError('The brain is not answering (vega-brain down?).');
  if (!r.ok) throw new ApiError(`The brain refused the request (HTTP ${r.status}).`);
  return (await r.json()) as T;
}

// --- DOM helpers: text only, never HTML ---
type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}
const card = (label: string, value: string, sub?: string, cls = '') => el('div', { class: 'card' }, el('span', {}, label), el('b', { class: cls }, value), sub ? el('small', {}, sub) : null);
function table(head: string[], rows: Child[][], numCols: number[] = []): HTMLElement {
  return el(
    'div',
    { class: 'tbl' },
    el('table', {}, el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { scope: 'col' }, h)))), el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', numCols.includes(i) ? { class: 'num' } : {}, c)))))),
  );
}
const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
const time = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function ago(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
function show(text: string | null, info = false): void {
  msg.hidden = !text;
  msg.className = info ? 'banner info' : 'banner';
  msg.textContent = text ?? '';
}

// --- API shapes (brain/src/api.ts) ---
interface MemoryItem {
  id: number;
  kind: string;
  level: 'normal' | 'private';
  text: string;
  pinned: boolean;
  created: number;
  expires: number | null;
  sent: { n: number; last: number | null };
}
interface Overview {
  now: number;
  pi: { cpuPct: number | null; tempC: number | null; memPct: number | null; uptimeS: number | null } | null;
  usage: { usd: number; budgetUsd: number; calls: number };
  health: { services: { name: string; state: string; health: string; restarts: number }[] | null; reportedAt: number | null; backup: { ts: string; ok: boolean; offsite: boolean; bytes?: number; error?: string } | null; diskFreePct: number | null; watchAt?: number | null; problems: { title: string; detail: string }[] } | null;
  presence: { home: boolean | null; device: string; updated: number } | null;
  devices: { online: number; total: number };
  reminders: number;
}
interface DeviceRow { key: string; room: string; name: string; kind: string | null; online: boolean; updated: number; on?: boolean; risk?: string; phrase?: string; tempC?: number; humidity?: number; co2Ppm?: number; presence?: boolean }
interface Reminder { id: number; at: number; text: string }
interface CommandRow { id: string; ts: number; text: string; origin: string; path: string; answer: string; tools: string[]; llmCalls: number }
interface Costs { budgetUsd: number; rows: { day: string; task: string; usd: number; calls: number }[] }
interface Access { google: string[] | null; github: string[] | null; ai: Record<string, string | null>; speechToText: string | null; webSearch: boolean; cameraLastUsed: number | null; phone: { device: string; updated: number } | null }

async function command(text: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    const r = await api<{ answer: string }>('/api/command', { method: 'POST', body: JSON.stringify({ text }) });
    show(r.answer || 'Done.', true);
  } catch (e) {
    show((e as Error).message);
  }
  await render();
}

const R: Record<Tab, () => Promise<Node[]>> = {
  async today() {
    const o = await api<Overview>('/api/overview');
    const h = o.health;
    const p = o.pi;
    const out: Node[] = [];
    const b = h?.backup;
    out.push(
      el(
        'div',
        { class: 'cards' },
        card('Pi', p?.tempC != null ? `${Math.round(p.tempC)} °C` : '—', p ? `CPU ${p.cpuPct ?? '—'}% · RAM ${p.memPct ?? '—'}%${p.uptimeS != null ? ` · up ${Math.floor(p.uptimeS / 86400)} d` : ''}` : 'no stats', p?.tempC != null && p.tempC >= 75 ? 'warn' : ''),
        card('AI today', usd(o.usage.usd), `of ${usd(o.usage.budgetUsd)} · ${o.usage.calls} calls`, o.usage.usd >= o.usage.budgetUsd ? 'bad' : ''),
        card('Devices', `${o.devices.online}/${o.devices.total}`, 'online', o.devices.online < o.devices.total ? 'warn' : 'ok'),
        card('Reminders', String(o.reminders), 'waiting'),
        card('You', o.presence ? (o.presence.home === true ? 'home' : o.presence.home === false ? 'away' : 'located') : '—', o.presence ? `${o.presence.device} · ${ago(o.presence.updated, o.now)}` : 'no phone (OwnTracks)'),
        card('Backup', !h ? 'not on this machine' : !b ? 'none yet' : b.ok ? ago(Date.parse(b.ts), o.now) : 'failed', b ? (b.ok ? (b.offsite ? 'also off the Pi' : 'on the Pi only') : (b.error ?? '')) : '', !h ? 'dim' : !b || !b.ok || !b.offsite ? 'warn' : 'ok'),
        card('Disk', h?.diskFreePct != null ? `${Math.round(h.diskFreePct)}%` : '—', 'free', h?.diskFreePct != null && h.diskFreePct < 10 ? 'bad' : ''),
        card('Pi 3 watchdog', h?.watchAt != null ? ago(h.watchAt, o.now) : '—', h?.watchAt != null ? 'last heartbeat' : 'not installed', h?.watchAt == null ? 'dim' : o.now - h.watchAt > 300_000 ? 'bad' : 'ok'),
      ),
    );
    if (!h) out.push(el('p', { class: 'note' }, 'Health checks run on the Pi only (HEALTH_WATCH=1): containers, disk, temperature, backups.'));
    else {
      out.push(el('h2', {}, h.problems.length ? `Problems (${h.problems.length})` : 'No problems'));
      if (h.problems.length) out.push(el('ul', { class: 'plain' }, ...h.problems.map((x) => el('li', {}, el('b', { class: 'bad' }, x.title), ` · ${x.detail}`))));
      out.push(el('h2', {}, `Services${h.reportedAt ? ` · reported ${ago(h.reportedAt, o.now)}` : ''}`));
      out.push(
        h.services
          ? table(['Service', 'State', 'Health', 'Restarts'], h.services.map((s) => [s.name, el('span', { class: s.state === 'running' ? 'ok' : 'bad' }, s.state), el('span', { class: s.health === 'unhealthy' ? 'bad' : s.health === 'healthy' ? 'ok' : 'dim' }, s.health), String(s.restarts)]), [3])
          : el('p', { class: 'note' }, 'No report from health.sh yet.'),
      );
    }
    return out;
  },
  async devices() {
    const list = await api<DeviceRow[]>('/api/devices');
    if (!list.length) return [el('p', { class: 'note' }, 'No devices yet.')];
    const reading = (d: DeviceRow) => [d.tempC !== undefined && `${d.tempC} °C`, d.humidity !== undefined && `${d.humidity}%`, d.co2Ppm !== undefined && `${d.co2Ppm} ppm`, d.presence !== undefined && (d.presence ? 'someone' : 'empty')].filter(Boolean).join(' · ');
    return [
      table(
        ['Room', 'Device', 'State', 'Online', 'Updated', ''],
        list.map((d) => {
          const btn = d.phrase && d.on !== undefined ? el('button', { type: 'button' }, d.on ? 'Turn off' : 'Turn on') : null;
          btn?.addEventListener('click', () => void command(`${d.on ? 'tắt' : 'bật'} ${d.phrase}`, btn));
          if (btn && !d.online) btn.disabled = true;
          return [d.room, d.name, d.on !== undefined ? el('span', { class: d.on ? 'ok' : 'dim' }, d.on ? 'on' : 'off') : reading(d) || '—', el('span', { class: d.online ? 'ok' : 'bad' }, d.online ? 'yes' : 'no'), ago(d.updated), btn];
        }),
      ),
      el('p', { class: 'note' }, 'High-risk devices still ask for confirmation on the VEGA screen.'),
    ];
  },
  async reminders() {
    const list = await api<Reminder[]>('/api/reminders');
    if (!list.length) return [el('p', { class: 'note' }, 'No reminders waiting. Say "nhắc tôi 3 giờ chiều gọi mẹ" to add one.')];
    return [
      table(
        ['#', 'When', 'What', ''],
        list.map((r) => {
          const btn = el('button', { type: 'button' }, 'Cancel');
          btn.addEventListener('click', () => void command(`huỷ nhắc ${r.id}`, btn));
          return [String(r.id), time(r.at), r.text, btn];
        }),
        [0, 1],
      ),
    ];
  },
  async memory() {
    const list = await api<MemoryItem[]>('/api/memory');
    if (!list.length) return [el('p', { class: 'note' }, 'VEGA remembers nothing yet. Say "nhớ là tôi dậy lúc 6 giờ" to teach it.')];
    return [
      table(
        ['#', 'Kind', 'Level', 'What', 'Sent to AI', '', ''],
        list.map((m) => {
          const lvl = el('button', { type: 'button' }, m.level === 'private' ? 'Make normal' : 'Make private');
          lvl.addEventListener('click', () => void command(`mục ${m.id} ${m.level === 'private' ? 'thường' : 'riêng tư'}`, lvl));
          const del = el('button', { type: 'button' }, 'Forget');
          del.addEventListener('click', () => void command(`quên mục ${m.id}`, del));
          const kind = `${m.kind}${m.pinned ? ' · pinned' : m.expires ? ` · until ${time(m.expires)}` : ''}`;
          return [String(m.id), kind, el('span', { class: m.level === 'private' ? 'ok' : 'dim' }, m.level === 'private' ? 'private' : 'normal'), m.text, m.sent.n ? `${m.sent.n}× · ${time(m.sent.last!)}` : 'never', lvl, del];
        }),
        [0, 4],
      ),
      el('p', { class: 'note' }, 'Private items never leave this Pi. Normal ones go to the cloud AI only when a question is about them, with known names replaced by aliases.'),
    ];
  },
  async commands() {
    const list = await api<CommandRow[]>('/api/commands?limit=500');
    const search = el('input', { type: 'search', id: 'cmdFilter', placeholder: 'Filter: text, answer, path', 'aria-label': 'Filter commands' });
    const holder = el('div');
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      const rows = list.filter((c) => !q || `${c.text} ${c.answer} ${c.path} ${c.origin}`.toLowerCase().includes(q));
      holder.replaceChildren(table(['When', 'Said', 'Path', 'AI', 'Answer'], rows.map((c) => [time(c.ts), c.text, c.path, String(c.llmCalls), c.answer]), [0, 3]));
    };
    search.addEventListener('input', paint);
    paint();
    return [search, holder, el('p', { class: 'note' }, `Latest ${list.length} commands. "AI" is the number of AI calls a command cost; 0 means it ran locally.`)];
  },
  async costs() {
    const c = await api<Costs>('/api/costs?days=30');
    const days = new Map<string, { total: number; parts: string[] }>();
    for (const r of c.rows) {
      const d = days.get(r.day) ?? { total: 0, parts: [] };
      d.total += r.usd;
      d.parts.push(`${r.task} ${usd(r.usd)} (${r.calls})`);
      days.set(r.day, d);
    }
    if (!days.size) return [el('p', { class: 'note' }, 'No AI spending in the last 30 days.')];
    const sum = [...days.values()].reduce((a, d) => a + d.total, 0);
    return [
      el('div', { class: 'cards' }, card('Last 30 days', usd(sum)), card('Daily budget', usd(c.budgetUsd))),
      table(
        ['Day', 'Total', 'Of budget', 'By kind of work'],
        [...days].map(([day, d]) => [day, usd(d.total), el('div', { class: 'bar', title: `${Math.round((d.total / c.budgetUsd) * 100)}% of the daily budget` }, el('i', { style: `width:${Math.min(100, (d.total / Math.max(c.budgetUsd, 1e-9)) * 100).toFixed(1)}%` })), d.parts.join(' · ')]),
        [0, 1],
      ),
    ];
  },
  async access() {
    const a = await api<Access>('/api/access');
    const row = (what: string, v: string) => [what, v];
    return [
      table(
        ['What', 'Access'],
        [
          row('Google', a.google ? a.google.join(', ') : 'not connected'),
          row('GitHub', a.github ? `read-only Actions: ${a.github.join(', ')}` : 'not connected'),
          row('AI', Object.entries(a.ai).map(([k, v]) => `${k}: ${v ?? 'off'}`).join(' · ')),
          row('Speech to text', a.speechToText ?? 'browser only'),
          row('Web search', a.webSearch ? 'Tavily' : 'off'),
          row('Camera', a.cameraLastUsed ? `photo last taken ${ago(a.cameraLastUsed)}` : 'no photo taken yet'),
          row('Phone location', a.phone ? `${a.phone.device}, last point ${ago(a.phone.updated)} (only the latest is kept)` : 'no phone'),
        ],
      ),
      el('p', { class: 'note' }, 'Change access in infra/pi/brain.env and .env on the Pi. Outside content (mail, logs, web pages) can never trigger an action.'),
    ];
  },
};

const current = (): Tab => (TABS as readonly string[]).includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : 'today';
let seq = 0;
async function render(): Promise<void> {
  const tab = current();
  for (const a of document.querySelectorAll<HTMLAnchorElement>('#tabs a')) {
    if (a.hash === `#${tab}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const mine = ++seq;
  try {
    const nodes = await R[tab]();
    if (mine !== seq) return; // another tab was opened meanwhile
    if (msg.className === 'banner') show(null);
    view.replaceChildren(...nodes);
  } catch (e) {
    if (mine !== seq) return;
    show(e instanceof ApiError ? e.message : `Something went wrong: ${(e as Error).message}`);
    view.replaceChildren();
  }
}

window.addEventListener('hashchange', () => {
  show(null);
  void render();
});
void render();
// the Today tab follows the Pi without a reload
setInterval(() => {
  if (current() === 'today' && document.visibilityState === 'visible') void render();
}, 30_000);
