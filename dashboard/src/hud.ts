// @ts-expect-error legacy template code (JS, no types): typed through HudApi below
import * as core from './main.js';

/** The slice of the template's runtime that the data layer and scene renderer use. */
export interface HudApi {
  setMode(mode: string, force?: boolean): void;
  getMode(): string;
  setLevel(level: string): void;
  getLevel(): string;
  setStatusOverride(text: string | null): void;
  setLog(entries: [string, string][] | null): void;
  zap(el: Element, text: string): void;
  barHtml(values: number[]): string;
  getQuality(): 'full' | 'lite' | 'css';
  isAutoQuality(): boolean;
  onQuality(cb: (q: 'full' | 'lite' | 'css') => void): void;
  hasWebGLContext(): boolean;
}
export interface HudModule {
  api: HudApi;
  hooks: { onCommand: ((text: string) => void) | null };
  start(): void;
}

export const hud = core as unknown as HudModule;
