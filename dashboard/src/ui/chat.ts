import type { SourceRef } from '@vega/contract';

/**
 * The conversation panel: what the owner sent and what VEGA answered (`command_result`, matched by command id).
 * Text only ever goes in through `textContent`. A command that could not be sent is said so, and put back in the box.
 */
export interface ChatDeps {
  root: HTMLElement;
  input: HTMLInputElement;
  /** Publishes the command; returns its id, or null if it could not be sent. */
  send(text: string): string | null;
  timeoutMs?: number;
  maxLines?: number;
}

/** "[1] Title · example.com", each a link opened in a new tab. Text only through textContent; https only (contract). */
function sourceList(sources: SourceRef[]): HTMLElement {
  const ol = document.createElement('ol');
  ol.className = 'src';
  for (const s of sources) {
    if (!/^https:\/\//.test(s.url)) continue;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    let host: string;
    try {
      host = new URL(s.url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    a.textContent = `[${s.n}] ${s.title}`;
    const h = document.createElement('small');
    h.textContent = ` · ${host}`;
    li.append(a, h);
    ol.append(li);
  }
  return ol;
}

export class Chat {
  /** Commands sent from this tab and still waiting for (or already timed out without) an answer. */
  private readonly pending = new Map<string, { line: HTMLElement; timer: ReturnType<typeof setTimeout> | null; quiet?: boolean }>();
  private readonly timeoutMs: number;
  private readonly maxLines: number;

  constructor(private readonly deps: ChatDeps) {
    this.timeoutMs = deps.timeoutMs ?? 30_000;
    this.maxLines = deps.maxLines ?? 30;
    this.deps.root.hidden = true;
  }

  /** Sends a command typed or spoken by the owner. Returns its id, or null if it was not sent. */
  submit(text: string): string | null {
    const clean = text.trim();
    if (!clean) return null;
    const line = this.add('you', 'You', clean);
    const id = this.deps.send(clean);
    if (id === null) {
      line.classList.add('fail');
      this.add('sys', 'VEGAS', 'Not sent — not connected. Try again when the header shows LIVE.');
      this.deps.input.value = clean;
      return null;
    }
    line.classList.add('wait');
    const timer = setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;
      p.timer = null;
      p.line.classList.remove('wait');
      this.add('sys', 'VEGAS', 'No answer — is the brain running?');
    }, this.timeoutMs);
    this.pending.set(id, { line, timer });
    return id;
  }

  /** A command the voice agent heard: shown like a typed one, but its answer is read aloud by the agent, not here. */
  heard(id: string, text: string): void {
    if (this.pending.has(id)) return;
    const line = this.add('you', 'You', text);
    line.classList.add('wait', 'voice');
    this.pending.set(id, { line, timer: null, quiet: true });
  }

  /** An answer from the brain. True if it answers a command typed or spoken in this tab (so it is read aloud here). */
  result(id: string, text: string, sources: SourceRef[] = []): boolean {
    const p = this.pending.get(id);
    if (!p) return false; // another tab's command, or an old retained answer
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    p.line.classList.remove('wait');
    const line = this.add('vega', 'VEGAS', text);
    if (sources.length) line.querySelector('span')!.append(sourceList(sources));
    this.deps.root.scrollTop = this.deps.root.scrollHeight;
    return !p.quiet;
  }

  /** Something the brain says on its own (a reminder, the briefing). */
  announce(text: string): void {
    this.add('vega', 'VEGAS', text);
  }

  /** A line from VEGA itself (a problem with voice, for instance). */
  note(text: string): void {
    this.add('sys', 'VEGAS', text);
  }

  private add(kind: 'you' | 'vega' | 'sys', who: string, text: string): HTMLElement {
    const { root } = this.deps;
    const p = document.createElement('p');
    p.className = `msg ${kind}`;
    const b = document.createElement('b');
    b.textContent = who;
    const s = document.createElement('span');
    s.textContent = text;
    p.append(b, s);
    root.append(p);
    while (root.children.length > this.maxLines) root.firstElementChild!.remove();
    root.hidden = false;
    root.parentElement?.classList.add('chatting'); // the panel now shows the answers the Idle caption showed
    root.scrollTop = root.scrollHeight;
    return p;
  }
}
