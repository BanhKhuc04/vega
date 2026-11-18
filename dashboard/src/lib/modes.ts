import type { Mode } from './types';

export type ModeEvent =
  | { type: 'goto'; mode: Mode }
  | { type: 'expand' } // "Mở rộng ⤢": research -> focus
  | { type: 'close' } // "×": focus -> research
  | { type: 'submit' } // a command was sent
  | { type: 'openHistoryItem' };

export function reduceMode(mode: Mode, event: ModeEvent): Mode {
  switch (event.type) {
    case 'goto':
      return event.mode;
    case 'expand':
      return mode === 'research' ? 'focus' : mode;
    case 'close':
      return mode === 'focus' ? 'research' : mode;
    case 'submit':
    case 'openHistoryItem':
      return 'research';
  }
}

const MODES: readonly Mode[] = ['idle', 'research', 'focus', 'history'];

/** `#/idle`, `#/research`, ... -> mode; `#/core` -> core preview; anything else -> null. */
export function parseHash(hash: string): { view: 'main'; mode: Mode | null } | { view: 'core' } {
  const key = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  if (key === 'core') return { view: 'core' };
  const mode = MODES.find((m) => m === key) ?? null;
  return { view: 'main', mode };
}
