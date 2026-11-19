/** Lower case, no diacritics (đ → d, CO₂ → co2), no punctuation, single spaces: "Phòng mấy độ?" → "phong may do". */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Wraps outside content (a log, an email, a web page) so it cannot close its own tag. */
export const wrapExternal = (x: { source: string; content: string }) =>
  `<external source="${x.source.replace(/[^\w.-]/g, '')}">\n${x.content.replace(/<\/?external/gi, '‹external')}\n</external>`;

/** Cuts `s` to `max` characters on a word boundary, with an ellipsis. */
export function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 0 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}
