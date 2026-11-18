import { z } from 'zod';
import { PAYLOAD_VERSION } from './version';

const v = z.literal(PAYLOAD_VERSION);
const ts = z.iso.datetime({ offset: true }).optional();
const num = z.number().finite();

/** `vega/<room>/<device_id>/state`. Any subset of fields; at least one must be present. */
export const deviceState = z
  .object({
    v,
    ts,
    temp_c: num.min(-50).max(150).optional(),
    humidity: num.min(0).max(100).optional(),
    co2_ppm: num.min(0).max(100_000).optional(),
    presence: z.boolean().optional(),
    on: z.boolean().optional(),
  })
  .refine((s) => ['temp_c', 'humidity', 'co2_ppm', 'presence', 'on'].some((k) => k in s && s[k as keyof typeof s] !== undefined), {
    message: 'state needs at least one reading',
  });
export type DeviceState = z.infer<typeof deviceState>;

export const DEVICE_KINDS = ['esp8266', 'esp32-s3', 'orangepi', 'pi', 'other'] as const;
export const deviceKind = z.enum(DEVICE_KINDS);
export type DeviceKind = z.infer<typeof deviceKind>;

/** `vega/<room>/<device_id>/meta` (retained). */
export const deviceMeta = z.object({
  v,
  kind: deviceKind,
  room_name: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(40).optional(),
});
export type DeviceMeta = z.infer<typeof deviceMeta>;

/** `vega/<room>/<device_id>/availability`: plain string so it can be an MQTT Last Will. */
export const availability = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(['online', 'offline']));
export type Availability = z.infer<typeof availability>;

/** `vega/<room>/<device_id>/set` for relays. */
export const relaySet = z.object({ v, on: z.boolean() });
export type RelaySet = z.infer<typeof relaySet>;

export const CORE_STATES = ['idle', 'listening', 'thinking', 'speaking', 'alert', 'sleep'] as const;
/** `vega/desk/core/state`. */
export const coreState = z.object({ v, state: z.enum(CORE_STATES) });
export type CoreStateMsg = z.infer<typeof coreState>;
