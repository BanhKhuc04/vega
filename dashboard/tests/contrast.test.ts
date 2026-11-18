import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// WCAG contrast of every text colour token against the darkest and the panel background.
const css = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const tok = (n: string) => new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i').exec(css)![1]!;
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('text contrast >= 4.5:1', () => {
  const bgs = [tok('bg'), '#060c18'];
  for (const name of ['text', 'white', 'soft', 'muted', 'ice', 'cyan', 'amber', 'red', 'green']) {
    for (const bg of bgs) {
      it(`--${name} on ${bg}`, () => expect(ratio(tok(name), bg)).toBeGreaterThanOrEqual(4.5));
    }
  }
  it('primary button label on cyan', () => expect(ratio(tok('bg'), tok('cyan'))).toBeGreaterThanOrEqual(4.5));
});
