import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the template markup (index.html body, without scripts) into the current jsdom document. */
export function loadTemplate(): void {
  const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8');
  const body = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = body;
}

/** Serialised copy of every scene section, to compare "after defaults" against "before anything". */
export function sectionsHtml(): Record<string, string> {
  const out: Record<string, string> = {};
  document.querySelectorAll<HTMLElement>('.tpl').forEach((el) => (out[el.dataset.tpl ?? '?'] = el.outerHTML));
  return out;
}
