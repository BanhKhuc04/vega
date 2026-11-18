import { DEVICES } from '../../tools/sim/src/simlib';
import { deviceTopic } from '@vega/contract';
import { Registry } from '../src/registry';

/** A registry filled the way the simulator fills the broker: same meta, aliases and risks. */
export function simRegistry(values: { temp?: number; humidity?: number; co2?: number } = {}): Registry {
  const r = new Registry();
  const j = (o: object) => JSON.stringify({ v: 1, ...o });
  for (const d of DEVICES) {
    r.apply(deviceTopic(d.room, d.id, 'meta'), j({ kind: d.kind, room_name: d.roomName, ...(d.aliases && { aliases: d.aliases }), ...(d.risk && { risk: d.risk }) }));
    r.apply(deviceTopic(d.room, d.id, 'availability'), 'online');
    if (d.role === 'env') r.apply(deviceTopic(d.room, d.id, 'state'), j({ temp_c: d.room === 'balcony' ? 24 : (values.temp ?? 27.4), humidity: values.humidity ?? 64, co2_ppm: values.co2 ?? 820 }));
    if (d.role === 'relay') r.apply(deviceTopic(d.room, d.id, 'state'), j({ on: false }));
    if (d.role === 'radar') r.apply(deviceTopic(d.room, d.id, 'state'), j({ presence: true }));
  }
  return r;
}
