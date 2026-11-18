# VEGA contract, revision 2

Source of truth: `packages/contract` (TypeScript + zod). This page is its human-readable form. If the two ever
disagree, the code wins and this page is a bug.

- Revision **2** = device topics (from the first UI brief, now with zod schemas) + the **scene protocol** `vega/ui/scene`.
- Every JSON payload carries `"v": 1`, the *payload version*. A message with another `v` is ignored.
  (`CONTRACT_VERSION = 2` is the revision of this document, `PAYLOAD_VERSION = 1` is the `v` field.)
- Prefix is `vega/` (the old `jarvis/` is retired).

## Conventions

- Payloads are UTF-8 JSON objects, except `availability`, which is the plain string `online` / `offline` (so it can be
  an MQTT Last Will).
- Timestamps are ISO-8601 strings with a timezone. Unknown fields are ignored.
- "Latest value" topics are published **retained** (`state`, `meta`, `availability`, `system/events/<type>`,
  `system/pi`, `system/net`, `ui/scene`), so a freshly opened display fills in at once. A broker keeps one retained
  message per *topic*, which is why latest-value events get a topic per type instead of sharing `system/events`.
- A malformed message (bad JSON, wrong types, unknown `type`) is dropped. It never breaks a display.
- QoS 0 is enough for displays. The dev broker has no authentication; `infra/pi` has users and an ACL.
- `<room>` and `<device_id>` match `[a-z0-9_-]+`. Rooms `system` and `ui` are reserved.

## Topics

| Topic | Direction | Retained | Payload |
|---|---|---|---|
| `vega/<room>/<device_id>/state` | device → all | yes | `deviceState` |
| `vega/<room>/<device_id>/meta` | device → all | yes | `deviceMeta` |
| `vega/<room>/<device_id>/availability` | device → all (+ Last Will) | yes | `online` \| `offline` |
| `vega/<room>/<device_id>/set` | brain/UI → device | no | `relaySet` (relays) |
| `vega/desk/core/state` | desk core → all | yes | `coreState` |
| `vega/system/events` | brain, CI watcher → all | no (stream) | `systemEvent` (by `type`) |
| `vega/system/events/<type>` | same, latest value | yes | same payload; one retained slot per type (`ci`, `next_event`, `co2_series`) |
| `vega/system/command` | UI → brain | no | `systemCommand` |
| `vega/system/pi` | Pi agent → all | yes | `piStats` |
| `vega/system/net` | Pi agent → all | yes | `netStats` |
| `vega/ui/scene` | brain → all displays | yes | `sceneMessage` |

The dashboard subscribes to `vega/+/+/state`, `vega/+/+/meta`, `vega/+/+/availability`, `vega/system/events`,
`vega/system/events/+`, `vega/system/pi`, `vega/system/net`, `vega/ui/scene`.

## Device payloads

**`state`**: any non-empty subset of the fields (a missing field means "unchanged").

```json
{ "v": 1, "ts": "2026-11-18T09:30:00Z", "temp_c": 28.4, "humidity": 72, "co2_ppm": 1180 }
{ "v": 1, "presence": true }
{ "v": 1, "on": false }
```
Ranges: `temp_c` -50…150, `humidity` 0…100, `co2_ppm` 0…100000. The Idle screen shows the **primary room**
(`bedroom` by default, `VEGA_ROOM` to change); other rooms only count towards the mesh.

**`meta`**: `{ "v": 1, "kind": "esp8266", "room_name": "Bedroom" }`. `kind` is one of `esp8266`, `esp32-s3`,
`orangepi`, `pi`, `other`.

**`availability`**: `online` or `offline`. The device sets `offline` as its MQTT Last Will. "Device mesh" counts
online/total devices and an `offline` message lowers the count immediately.

**`set`** (relays): `{ "v": 1, "on": true }`.

**`vega/desk/core/state`**: `{ "v": 1, "state": "listening" }`, `state` ∈ `idle | listening | thinking | speaking | alert | sleep`.

## System payloads

Events are discriminated by `type`, and the payload is the same on `vega/system/events` and on
`vega/system/events/<type>` (a display applies whichever arrives):

```json
{ "v": 1, "type": "ci", "repo": "firmware-esp", "failed": 1, "ts": "2026-11-18T09:26:00Z" }
{ "v": 1, "type": "next_event", "title": "lab report", "detail": "computer networks", "at": "2026-11-18T09:30:00Z" }
{ "v": 1, "type": "co2_series", "room": "bedroom", "values": [980, 1080, 1190], "threshold_ppm": 1000, "max_ppm": 1500 }
{ "v": 1, "type": "command_result", "id": "UI-m3k2x9-0", "result": "Light is off" }
```

`vega/system/command` (published by the dashboard's command bar when connected):
`{ "v": 1, "id": "UI-m3k2x9-0", "text": "turn off the light", "ts": "2026-11-18T09:30:00Z" }`.

`vega/system/pi`: `{ "v": 1, "cpu_pct": 23, "temp_c": 52, "mem_pct": 41, "uptime_s": 518400 }` (all optional).
`vega/system/net`: `{ "v": 1, "latency_ms": 38 }`.

### What the Idle screen shows, and where it comes from

| Idle / header / callout | Source |
|---|---|
| Room name, temperature, humidity, CO₂, sparkline | `state` of the primary room (+ `meta.room_name`); sparkline = last 24 CO₂ readings (seeded by `co2_series`) |
| Presence | `state.presence` of the primary room |
| Device mesh x/y, kinds | `availability` + `meta.kind` of every device |
| CI/CD | latest `ci` event |
| Up next | latest `next_event` |
| `PI · 52°C`, `CORE TEMP` | `vega/system/pi.temp_c` |
| `LATENCY` | `vega/system/net.latency_ms` |

Anything not received yet shows the template's sample value with a `sample data` tag.

## The scene protocol: `vega/ui/scene`

The brain is the only one that decides what the screens show. Every display (the Pi kiosk, tabs on the PC) renders the
same scene.

```json
{
  "v": 1,
  "scene": "research",
  "level": "normal",
  "status": "Researching · step 4/5",
  "ttl": 600,
  "ts": "2026-11-18T09:30:00Z",
  "id": "research-0207",
  "data": { "title": "Research: standing desk height", "step": { "current": 4, "total": 5, "label": "comparing sources" } }
}
```

| Field | Meaning |
|---|---|
| `scene` | one of `idle listen think research locate vision briefing focus alert success sleep` |
| `level` | `normal` \| `medium` \| `high`. Priority colour (ignored by `alert` and `success`, which have fixed colours) |
| `status` | text for the header status line (default: the template's text for the scene) |
| `orb` | reserved; accepted, the orb currently follows `scene` |
| `ttl` | seconds the scene stays up; then the display returns to `idle`. Counted from `ts` (so a retained copy delivered late is not shown again after it expired), or from arrival if `ts` is missing. No `ttl`: stays until replaced |
| `id` | optional label for logs |
| `data` | scene data, see below. **Every field is optional**; a missing field shows the template's own text |

Rules a display follows (`dashboard/src/scene`):

1. Valid payload → fill `data` into the template, switch scene (the template's own animations: `countUp`, `scramble`, `typeText`, `zap`, `revealPanels`), apply `level`.
2. Invalid payload (bad JSON, wrong schema) → ignored, one `console.warn` per run of invalid messages, nothing else happens.
3. Identical message delivered again (retained message after a reconnect) → ignored; an expired one → ignored.
4. `ttl` runs out → `idle` (unless the viewer already moved elsewhere by hand).
5. The dock, number keys and `#hash` keep working for manual viewing.
6. Text from the network is only ever inserted as text, never as HTML.

### `data` per scene

| Scene | Fields |
|---|---|
| `idle` | `caption` |
| `listen` | `transcript`, `hint` |
| `think` | `chips[{label, state: done\|run\|wait}]` (1–6), `plan` |
| `research` | `title`, `step{current,total,label}`, `stat{sources,text,ref,progress 0..1}`, `chart{title,values[],thresholdPpm,maxPpm,summary,footnote}`, `steps[{label,state}]`, `source{title,caption}`, `compare{title,columns[],rows[{label,cells[{text,tone: ok\|warn\|plain}]}]}`, `note{text,refs}`, `log[{tag,msg}]` |
| `locate` | `title`, `status`, `target{name,distanceKm,detail,coord}`, `route{title,steps[]}` |
| `vision` | `camera` |
| `briefing` | `kicker`, `title`, `summary`, `agenda[{time,title,hot}]`, `inbox[{from,subject}]`, `room`, `builds{passing,failing,repo}` |
| `focus` | `kicker`, `minutes` (1–180), `hint` |
| `alert` | `title`, `ref`, `error`, `note` |
| `success` | `title`, `ref`, `checks[]` |
| `sleep` | `title`, `lightsOffSeconds`, `alarm`, `dnd` |

One example per scene lives in `tools/sim/examples/*.json` (validated by tests). Send one with
`npm run scene -- research tools/sim/examples/research.json`.

The map (`locate`), the camera feed (`vision`) and the datasheet drawing (`research` → source) are still the
template's simulated pictures; real ones arrive with M7/M8.

## Versioning

A breaking change bumps `PAYLOAD_VERSION` and the revision of this document. Displays ignore messages whose `v`
they do not know.
