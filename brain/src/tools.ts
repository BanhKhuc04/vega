import type { Metric } from './registry';

export type ToolName = 'list_devices' | 'get_sensor' | 'set_device' | 'run_scene';
export const SCENE_NAMES = ['sleep', 'focus'] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export type ToolCall =
  | { name: 'list_devices'; args: Record<string, never> }
  | { name: 'get_sensor'; args: { metric: Metric; room?: string } }
  | { name: 'set_device'; args: { device: string; on: boolean } }
  | { name: 'run_scene'; args: { name: SceneName } };

/** Tools that change something in the physical world. They only run on a direct command from the owner. */
export const PHYSICAL: ReadonlySet<ToolName> = new Set(['set_device', 'run_scene']);
