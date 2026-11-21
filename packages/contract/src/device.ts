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

export const RISKS = ['low', 'high'] as const;
/** `low`: the brain acts at once (lights, fans). `high`: needs the owner's confirmation on screen (PC power, big loads). */
export const risk = z.enum(RISKS);
export type Risk = z.infer<typeof risk>;

/**
 * `vega/<room>/<device_id>/meta` (retained). The brain builds its device dictionary and tools from it:
 * `aliases` are the words the owner uses for the device (any language), `risk` ranks physical commands.
 * A switchable device without `risk` is treated as `high`.
 */
export const deviceMeta = z.object({
  v,
  kind: deviceKind,
  room_name: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(40).optional(),
  aliases: z.array(z.string().min(1).max(30)).max(8).optional(),
  risk: risk.optional(),
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
export const MIC_STATES = ['on', 'off', 'missing'] as const;
/** `vega/desk/core/state`. `mic` (v5): the voice agent's microphone; `off` = closed by the owner's hotkey, `missing` = unplugged. */
export const coreState = z.object({ v, state: z.enum(CORE_STATES), mic: z.enum(MIC_STATES).optional() });
export type CoreStateMsg = z.infer<typeof coreState>;
export const CAMERA_STATES = ['on', 'missing'] as const;
/** `vega/desk/camera/state` (v6, retained, from the brain): `missing` = the camera is unplugged. */
export const cameraState = z.object({ v, camera: z.enum(CAMERA_STATES) });
