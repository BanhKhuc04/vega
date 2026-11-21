import { sceneExpiresAt } from '@vega/contract';
import type { SceneMessage } from '@vega/contract';
import type { HudApi } from '../hud';
import { renderScene } from './render';

export interface ControllerDeps {
  hud: Pick<HudApi, 'setMode' | 'getMode' | 'setLevel' | 'setStatusOverride' | 'setLog' | 'setVision'>;
  root?: ParentNode;
  now?: () => number;
}

/**
 * Applies validated scenes to the display: renders `data` into the template, switches mode, applies level,
 * and returns to idle when the ttl runs out. A repeated identical scene is ignored, so a retained message
 * redelivered after a reconnect does not replay the intro; a scene whose ttl already ran out is ignored.
 */
export class SceneController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastKey = '';
  private current: SceneMessage | null = null;
  private readonly now: () => number;
  private readonly root: ParentNode;

  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? Date.now;
    this.root = deps.root ?? document;
  }

  handle(scene: SceneMessage): boolean {
    const now = this.now();
    const expires = sceneExpiresAt(scene, now);
    if (expires !== null && expires <= now) return false;
    const key = JSON.stringify(scene);
    if (key === this.lastKey && this.current && this.deps.hud.getMode() === scene.scene) return false;
    this.lastKey = key;
    this.current = scene;
    this.clearTimer();

    const { hud } = this.deps;
    renderScene(scene, this.root, hud);
    hud.setStatusOverride(scene.status ?? null);
    hud.setMode(scene.scene, true);
    hud.setStatusOverride(null);
    if (scene.level) hud.setLevel(scene.level);

    if (expires !== null) {
      this.timer = setTimeout(() => this.expire(scene), Math.max(0, expires - now));
    }
    return true;
  }

  private expire(scene: SceneMessage): void {
    this.timer = null;
    if (this.current !== scene) return;
    this.current = null;
    this.lastKey = '';
    // Only leave if the viewer is still on that scene (they may have switched by hand).
    if (this.deps.hud.getMode() === scene.scene && scene.scene !== 'idle') this.deps.hud.setMode('idle');
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.clearTimer();
  }
}
