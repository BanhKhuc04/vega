/**
 * Revision of the contract as a whole (docs/contract.md). v2 = device topics + scene protocol; v3 = `meta.aliases` /
 * `meta.risk` (M1 brain); v4 = `command_result` up to 2000 characters with `speak` and `sources` (M6 research);
 * v5 = `command.via` and `core/state.mic` (M5.2 voice agent); v6 = `camera/state` and the photo in the `vision` scene (M7);
 * v7 = `vision.mode` (M7.1 live video); v8 = `system/health`, `system/backup`, `system/presence`, OwnTracks locations and a
 * real position in the `locate` scene (M8); v9 = `system/watch`, the Pi 3 watchdog's heartbeat (M10).
 */
export const CONTRACT_VERSION = 9;
/** Value of the `"v"` field every JSON payload carries. Messages with another value are ignored. */
export const PAYLOAD_VERSION = 1;
