/**
 * Revision of the contract as a whole (docs/contract.md). v2 = device topics + scene protocol; v3 = `meta.aliases` /
 * `meta.risk` (M1 brain); v4 = `command_result` up to 2000 characters with `speak` and `sources` (M6 research).
 */
export const CONTRACT_VERSION = 4;
/** Value of the `"v"` field every JSON payload carries. Messages with another value are ignored. */
export const PAYLOAD_VERSION = 1;
