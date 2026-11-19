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

export class Chat {
  /** Commands sent from this tab and still waiting for (or already timed out without) an answer. */
  private readonly pending = new Map<string, { line: HTMLElement; timer: ReturnType<typeof setTimeout> | null }>();
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
      this.add('sys', 'VEGA', 'Not sent — not connected. Try again when the header shows LIVE.');
      this.deps.input.value = clean;
      return null;
    }
    line.classList.add('wait');
    const timer = setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;
      p.timer = null;
      p.line.classList.remove('wait');
      this.add('sys', 'VEGA', 'No answer — is the brain running?');
    }, this.timeoutMs);
    this.pending.set(id, { line, timer });
    return id;
  }

  /** An answer from the brain. Returns true if it answers a command sent from this tab (so it may be read aloud). */
  result(id: string, text: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false; // another tab's command, or an old retained answer
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    p.line.classList.remove('wait');
    this.add('vega', 'VEGA', text);
    return true;
  }

  /** Something the brain says on its own (a reminder, the briefing). */
  announce(text: string): void {
    this.add('vega', 'VEGA', text);
  }

  /** A line from VEGA itself (a problem with voice, for instance). */
  note(text: string): void {
    this.add('sys', 'VEGA', text);
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
