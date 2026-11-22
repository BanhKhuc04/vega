#!/usr/bin/env bash
# Nightly backup of VEGA (brief 0013 B1-B3). Run by the vega-backup systemd timer that setup.sh installs, or by hand:
#
#   sudo ./infra/pi/backup.sh              # back up now
#   ./infra/pi/backup.sh --dry-run         # no MQTT report, no offsite copy (CI; BRAIN_DB_FILE points at a local file)
#
# What: brain.db (a consistent copy taken with VACUUM INTO while the brain runs), google-token.json if any, .env,
# brain.env, mosquitto/passwd and rclone's config (the Drive token, so a rebuilt Pi keeps the offsite copy). Images and models are rebuilt from the repository, so they are not backed up.
# Encrypted with age for AGE_RECIPIENT (.env); only the owner holds the private key. 14 copies stay in BACKUP_DIR,
# one more goes to RCLONE_REMOTE when set. Restore: sudo ./infra/pi/setup.sh --restore <file.age> (docs/pi-setup.md).
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  -h | --help) sed -n '2,10p' "$0"; exit 0 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

HERE="${VEGA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
ENV_FILE="$HERE/.env"
COMPOSE=(docker compose -f "$HERE/docker-compose.yml" --env-file "$ENV_FILE")
KEEP="${KEEP:-14}"

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -n1; }

BACKUP_DIR="${BACKUP_DIR:-$(env_get BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vega}"
RECIPIENT="${AGE_RECIPIENT:-$(env_get AGE_RECIPIENT)}"
REMOTE="${RCLONE_REMOTE:-$(env_get RCLONE_REMOTE)}"

# report <ok> <bytes> <offsite> <error>: retained on vega/system/backup, read by the brain (Alert when old or failed)
report() {
  [ "$DRY" = 1 ] && return 0
  local msg
  msg="{\"v\":1,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":$1,\"bytes\":$2,\"offsite\":$3${4:+,\"error\":\"$4\"}}"
  "${COMPOSE[@]}" exec -T mosquitto mosquitto_pub -u health -P "$(env_get MQTT_HEALTH_PASS)" -r -t vega/system/backup -m "$msg" ||
    echo "could not report to MQTT" >&2
}

fail() {
  echo "backup failed: $1" >&2
  report false 0 false "$(printf '%s' "$1" | tr -d '"\\' | cut -c1-180)"
  exit 1
}

command -v age >/dev/null || fail "age is not installed (apt install age)"
[ -n "$RECIPIENT" ] || fail "AGE_RECIPIENT is empty in .env (setup.sh creates the key)"
[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found"

TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/infra/mosquitto"

# 1. the database, consistent while the brain writes (node:sqlite, built into the brain's Node)
if [ -n "${BRAIN_DB_FILE:-}" ]; then
  node -e 'const {DatabaseSync}=require("node:sqlite");new DatabaseSync(process.argv[1]).exec("VACUUM INTO \x27"+process.argv[2].replace(/\x27/g,"\x27\x27")+"\x27")' "$BRAIN_DB_FILE" "$TMP/brain.db" ||
    fail "could not copy $BRAIN_DB_FILE"
else
  "${COMPOSE[@]}" exec -T vega-brain node -e 'const fs=require("node:fs");fs.rmSync("/data/.backup.db",{force:true});new (require("node:sqlite").DatabaseSync)(process.env.BRAIN_DB).exec("VACUUM INTO \x27/data/.backup.db\x27")' ||
    fail "VACUUM INTO failed in vega-brain"
  "${COMPOSE[@]}" cp vega-brain:/data/.backup.db "$TMP/brain.db" >/dev/null || fail "could not copy brain.db out of vega-brain"
  "${COMPOSE[@]}" exec -T vega-brain rm -f /data/.backup.db || true
  "${COMPOSE[@]}" cp vega-brain:/data/google-token.json "$TMP/google-token.json" >/dev/null 2>&1 || true
fi

# 2. secrets: passwords, AI keys, the Google refresh token in brain.env
cp "$ENV_FILE" "$TMP/infra/.env"
[ -f "$HERE/brain.env" ] && cp "$HERE/brain.env" "$TMP/infra/brain.env"
[ -f "$HERE/mosquitto/passwd" ] && cp "$HERE/mosquitto/passwd" "$TMP/infra/mosquitto/passwd"
RCONF="${RCLONE_CONFIG:-}"
if [ -z "$RCONF" ] && command -v rclone >/dev/null; then RCONF="$(rclone config file 2>/dev/null | tail -n1 || true)"; fi
if [ -n "$RCONF" ] && [ -f "$RCONF" ]; then cp "$RCONF" "$TMP/infra/rclone.conf"; fi

# 3. one encrypted file; nothing unencrypted ever lands in BACKUP_DIR
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
OUT="$BACKUP_DIR/vega-$(date +%Y%m%d-%H%M%S).tar.gz.age"
tar -czf - -C "$TMP" . | age -r "$RECIPIENT" -o "$OUT.part" || fail "encryption failed"
mv "$OUT.part" "$OUT"
BYTES="$(wc -c <"$OUT" | tr -d ' ')"

# 4. keep the newest KEEP copies
ls -1t "$BACKUP_DIR"/vega-*.tar.gz.age 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do rm -f "$old"; done

# 5. one copy off the Pi
OFFSITE=false
if [ "$DRY" = 0 ] && [ -n "$REMOTE" ]; then
  if command -v rclone >/dev/null && rclone copy "$OUT" "$REMOTE"; then
    OFFSITE=true
    rclone delete "$REMOTE" --min-age "${KEEP}d" --include 'vega-*.tar.gz.age' >/dev/null 2>&1 || true
  else
    echo "offsite copy to $REMOTE failed (rclone missing or not configured)" >&2
  fi
fi

report true "$BYTES" "$OFFSITE" ""
echo "backup: $OUT ($BYTES bytes, offsite: $OFFSITE)"
