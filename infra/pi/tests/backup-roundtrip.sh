#!/usr/bin/env bash
# backup.sh end to end without a Pi (CI, brief 0013 DoD): back up a sample brain.db and secrets, check that nothing in the
# backup folder is readable, decrypt with the private key, compare. Needs node 22 and age.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/pi/mosquitto" "$W/out" "$W/restore"

age-keygen -o "$W/key.txt" 2>/dev/null
pub="$(sed -n 's/^# public key: //p' "$W/key.txt")"
printf 'MQTT_BRAIN_PASS=secret-brain-pass\nAGE_RECIPIENT=%s\n' "$pub" >"$W/pi/.env"
echo 'LLM_X_API_KEY=sk-test-secret' >"$W/pi/brain.env"
echo 'brain:$7$101$hash' >"$W/pi/mosquitto/passwd"
node -e '
  const { DatabaseSync } = require("node:sqlite");
  const d = new DatabaseSync(process.argv[1]);
  d.exec("PRAGMA journal_mode = WAL; CREATE TABLE reminders (id INTEGER PRIMARY KEY, text TEXT)");
  for (let i = 0; i < 3; i++) d.prepare("INSERT INTO reminders (text) VALUES (?)").run("reminder " + i);
' "$W/brain.db"

backup() { VEGA_DIR="$W/pi" BACKUP_DIR="$W/out" BRAIN_DB_FILE="$W/brain.db" bash "$ROOT/infra/pi/backup.sh" --dry-run >/dev/null; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

backup
files=("$W"/out/vega-*.tar.gz.age)
[ "${#files[@]}" -eq 1 ] || fail "expected one backup, got ${#files[@]}"
f="${files[0]}"
if ls "$W/out" | grep -v '\.tar\.gz\.age$' | grep -q .; then fail "something other than an encrypted backup in the folder"; fi
if grep -aq -e 'secret-brain-pass' -e 'sk-test-secret' -e 'reminder 1' "$f"; then fail "the backup is readable without the key"; fi

age -d -i "$W/key.txt" "$f" | tar -xzf - -C "$W/restore"
n="$(node -e 'const { DatabaseSync } = require("node:sqlite"); console.log(new DatabaseSync(process.argv[1]).prepare("SELECT COUNT(*) AS n FROM reminders").get().n)' "$W/restore/brain.db")"
[ "$n" = 3 ] || fail "restored brain.db has $n reminders, expected 3"
cmp -s "$W/pi/.env" "$W/restore/infra/.env" || fail ".env differs"
cmp -s "$W/pi/brain.env" "$W/restore/infra/brain.env" || fail "brain.env differs"
cmp -s "$W/pi/mosquitto/passwd" "$W/restore/infra/mosquitto/passwd" || fail "passwd differs"

# only the newest KEEP copies stay (names carry the second, hence the pauses)
for _ in 1 2 3; do
  sleep 1.1
  KEEP=2 backup
done
left="$(ls "$W"/out/vega-*.tar.gz.age | wc -l | tr -d ' ')"
[ "$left" = 2 ] || fail "expected 2 backups after pruning, got $left"

# no recipient: refuses, writes nothing
sed -i 's/^AGE_RECIPIENT=.*/AGE_RECIPIENT=/' "$W/pi/.env"
if backup 2>/dev/null; then fail "backed up without AGE_RECIPIENT"; fi

echo "backup round trip: ok"
