# VEGA MQTT contract — version 1

Status: v1, introduced with Decision Brief 0001. All parsing lives in `dashboard/src/lib/parse.ts`,
so a contract change is a one-file change. Prefix is `vega/` (D1; the roadmap's `jarvis/` is retired).

## Conventions

- Payloads are UTF-8 JSON objects with `"v": 1` (contract version). Messages with a missing or
  different `v` are ignored by the UI.
- `availability` payloads are the plain strings `online` / `offline` (so they can be an MQTT Last Will).
- Timestamps are ISO-8601 strings (UTC). Unknown fields are ignored.
- `state`, `meta`, `availability` and `system/events` of the "latest value" kind should be published
  **retained**, so a freshly opened dashboard fills in immediately.
- A malformed message (bad JSON, wrong types, unknown `type`) is dropped; it never breaks the UI.
- QoS 0 is enough for the UI. The dev broker has no auth; production auth/ACL/TLS arrives in Phase 1.

## Device topics: `vega/<room>/<device_id>/{state,set,meta,availability}`

| Leaf | Direction | Retained | Purpose |
|---|---|---|---|
| `state` | device → UI | yes | latest readings |
| `set` | UI/brain → device | no | commands to the device (not used by the dashboard in v0.1) |
| `meta` | device → UI | yes | static description |
| `availability` | device → UI | yes (+ LWT) | `online` / `offline` |

`<room>` and `<device_id>` are lowercase `[a-z0-9_-]+`. The reserved room `system` is not a device room.

### `vega/<room>/<device_id>/state` — environment sensor

Widget: "Phòng ngủ" (top-left of the Idle screen). Any subset of the three fields may be present
(missing = unchanged); at least one must be.

```json
{ "v": 1, "ts": "2026-11-18T09:30:00Z", "temp_c": 28.4, "humidity": 72, "co2_ppm": 1180 }
```

The widget shows the most recent environment state. CO₂ above the series threshold (default 1000 ppm)
is drawn amber with ▲.

### `vega/<room>/<device_id>/meta`

```json
{ "v": 1, "kind": "esp8266", "room_name": "Phòng ngủ" }
```

`kind` ∈ `esp8266` | `esp32-s3` (anything else is shown as `unknown`). `room_name` is the display name of the room.

### `vega/<room>/<device_id>/availability`

```
online
```
```
offline
```

Widget "Mạng thiết bị": `MQTT <online>/<total>`, counts per `kind`, and the ids of offline devices in red.
An `offline` message updates the UI immediately.

### `vega/<room>/<device_id>/set`

Reserved for device commands, e.g. `{ "v": 1, "on": false }`. Schema is per device type and defined in Phase 1.

## `vega/desk/core/state` — round desk core

Drives the round screen (and the live value shown on `#/core`).

```json
{ "v": 1, "state": "listening" }
```

`state` ∈ `idle` | `listening` | `thinking` | `speaking` | `alert` | `sleep`.
(`vega/desk/core/{meta,availability}` follow the device rules above.)

## `vega/system/events` — one topic, discriminated by `type`

### `ci` — widget "CI/CD"

```json
{ "v": 1, "type": "ci", "repo": "firmware-esp", "failed": 1, "ts": "2026-11-18T09:26:00Z" }
```

`failed` = number of failing builds (0 shows "build ổn").

### `next_event` — widget "Kế tiếp"

```json
{ "v": 1, "type": "next_event", "title": "nộp lab", "at": "2026-11-18T09:30:00Z" }
```

### `co2_series` — CO₂ chart (Research and Focus screens)

```json
{ "v": 1, "type": "co2_series", "room": "bedroom", "threshold_ppm": 1000, "max_ppm": 1500,
  "values": [980, 1080, 1190, 1290, 1380, 1420, 1360, 1100, 820, 700, 640, 620, 650, 720, 780, 760, 740, 800, 860, 900, 940, 960, 940, 960] }
```

`values`: 1–96 non-negative numbers; index = hour of day for a 24-value series. `threshold_ppm` (default 1000) and
`max_ppm` (chart scale, default 1500) are optional.

### `research` — current research session

```json
{ "v": 1, "type": "research", "session": {
  "id": "VG-0141", "title": "Nghiên cứu: cảm biến CO₂ cho phòng ngủ",
  "step_no": 3, "step_count": 5, "phase": "đang đọc nguồn",
  "sources": 12, "sources_desc": "datasheet, tài liệu thư viện, diễn đàn", "ref": "VG-0141 · 13:24:02",
  "steps": [
    { "label": "Hiểu câu hỏi", "state": "done" },
    { "label": "Đọc & trích xuất", "state": "active", "detail": "8/12", "progress": 0.66 },
    { "label": "Trả lời kèm nguồn", "state": "todo" }
  ],
  "source_caption": "Cảm biến NDIR đo CO₂ thật",
  "compare": { "title": "NDIR vs MOX", "columns": ["Tiêu chí", "NDIR", "MOX"],
    "rows": [ { "label": "Đo CO₂", "cells": [ { "text": "Thật", "tone": "good" }, { "text": "Ước lượng", "tone": "warn" } ] } ] },
  "note": "Nên chọn cảm biến NDIR…", "note_refs": "nguồn [1] [4] [7]" } }
```

`state` ∈ `done` | `active` | `todo`; `tone` ∈ `good` | `warn` | `plain`. Required: `id`, `title`, `step_no`,
`step_count`, `phase`, `steps`, `compare`. Everything else is optional.

### `command_result` — result of a command sent from the UI

```json
{ "v": 1, "type": "command_result", "id": "UI-m3k2x9-0", "result": "Đã tắt 1 đèn" }
```

`id` is the id the UI put in the command.

## `vega/system/command` — UI → brain

Published by the command bar (Enter or "Gửi"), not retained:

```json
{ "v": 1, "id": "UI-m3k2x9-0", "text": "nghiên cứu cảm biến CO₂", "ts": "2026-11-18T09:30:00Z" }
```

If the UI is disconnected it does **not** publish; it records the command as "Chưa gửi được: mất kết nối".

## What the dashboard subscribes to

```
vega/+/+/state
vega/+/+/meta
vega/+/+/availability
vega/system/events
vega/desk/core/state     (also matched by vega/+/+/state; handled specially)
```

## Versioning

Breaking changes bump `v` and the title of this document. The UI ignores messages whose `v` it does not know.
