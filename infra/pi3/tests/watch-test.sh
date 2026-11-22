#!/usr/bin/env bash
# vega-watch.sh without a Pi (CI, brief 0014 DoD): mosquitto_sub, mosquitto_pub, tailscale and curl are fakes on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/state"

cat >"$W/bin/mosquitto_sub" <<'EOF'
#!/usr/bin/env bash
[ -f "$FAKE/health" ] && cat "$FAKE/health" || exit 27
EOF
cat >"$W/bin/mosquitto_pub" <<'EOF'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do [ "$1" = -m ] && echo "$2" >>"$FAKE/beats"; shift; done
EOF
cat >"$W/bin/tailscale" <<'EOF'
#!/usr/bin/env bash
[ -f "$FAKE/ping-ok" ]
EOF
cat >"$W/bin/curl" <<'EOF'
#!/usr/bin/env bash
[ -f "$FAKE/ntfy-down" ] && exit 7
while [ $# -gt 0 ]; do [ "$1" = -d ] && echo "$2" >>"$FAKE/pushes"; shift; done
EOF
chmod +x "$W/bin/"*

T0=$(date -d '2026-11-22T10:00:00Z' +%s)
now=$T0
report() { printf '{"v":1,"ts":"%s","services":[]}' "$(date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ)" >"$W/health"; }
run() {
  FAKE="$W" PATH="$W/bin:$PATH" PI4_HOST=vega MQTT_PASS=p NTFY_TOKEN=tk_test NTFY_TOPIC=vega-test STATE_DIR="$W/state" NOW="$now" \
    bash "$ROOT/infra/pi3/vega-watch.sh" >/dev/null 2>&1
  now=$((now + 60))
}
pushes() { [ -f "$W/pushes" ] && wc -l <"$W/pushes" | tr -d ' ' || echo 0; }
fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# fresh report: no push, one heartbeat with this minute's time
report "$now"
run
[ "$(pushes)" = 0 ] || fail "pushed while the Pi 4 is fine"
grep -q '"ts":"2026-11-22T10:00:00Z"' "$W/beats" || fail "no heartbeat"

# report stops: 1-2 misses then back = nothing; a report 2 minutes old is still fine
run
run
report "$now"
run
[ "$(pushes)" = 0 ] || fail "pushed after only 2 misses"

# 3 misses in a row, Pi 4 not answering: exactly one urgent push, saying it does not answer
for _ in 1 2 3 4 5 6; do run; done
[ "$(pushes)" = 1 ] || fail "expected one push for the outage, got $(pushes)"
grep -q '"priority":5' "$W/pushes" || fail "outage not urgent"
grep -q 'không trả lời' "$W/pushes" || fail "wrong cause"

# back: exactly one more push
report "$now"
run
run
[ "$(pushes)" = 2 ] || fail "expected one 'back' push, got $(($(pushes) - 1))"
tail -n1 "$W/pushes" | grep -q 'trở lại' || fail "no 'back' message"

# MQTT stops but the Pi answers ping: the other cause; the broker being gone entirely counts as a miss too
rm -f "$W/health"
touch "$W/ping-ok"
for _ in 1 2 3; do run; done
tail -n1 "$W/pushes" | grep -q 'còn trả lời mạng' || fail "wrong cause when the Pi answers ping"

# ntfy down while the Pi 4 comes back: the 'back' push is retried next minute
report "$now"
touch "$W/ntfy-down"
run
rm -f "$W/ntfy-down"
before=$(pushes)
report "$now"
run
[ "$(pushes)" = $((before + 1)) ] || fail "'back' push not retried after ntfy was down"

# the token never ends up in a message
if grep -q tk_test "$W/pushes"; then fail "token in a message"; fi

echo "vega-watch: ok"
