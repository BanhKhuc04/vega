#!/usr/bin/env bash
# The Pi 3 watchdog (brief 0014 P3-P4), run every minute by the vega-watch systemd timer that infra/pi3/setup.sh installs.
# Reads the Pi 4's retained health report (vega/system/health, published every minute by infra/pi/health.sh). Missing or
# older than STALE_S for FAILS runs in a row: one urgent ntfy push saying why. Back: one push "Pi 4 is back". Also beats on
# vega/system/watch so the Pi 4 can tell when this Pi dies. Settings come from /etc/vega-watch.env (setup.sh writes it).
set -uo pipefail

: "${PI4_HOST:?}" "${MQTT_PASS:?}" "${NTFY_TOKEN:?}" "${NTFY_TOPIC:?}"
MQTT_PORT="${MQTT_PORT:-1883}"
MQTT_USER="${MQTT_USER:-watch}"
NTFY_URL="${NTFY_URL:-http://127.0.0.1:2586}"
STATE_DIR="${STATE_DIR:-/var/lib/vega-watch}"
STALE_S="${STALE_S:-180}"
FAILS="${FAILS:-3}"
# a powered-off Pi 4 leaves the MQTT connect hanging for minutes (-W does not cover it): cap every call
MQTT_TIMEOUT_S="${MQTT_TIMEOUT_S:-15}"
NOW="${NOW:-$(date +%s)}"

mkdir -p "$STATE_DIR"
mqtt=(-h "$PI4_HOST" -p "$MQTT_PORT" -u "$MQTT_USER" -P "$MQTT_PASS")

# push <priority> <title> <message>: the texts are fixed strings below, no JSON escaping needed
push() {
  curl -fsS -m 10 -o /dev/null -H "Authorization: Bearer $NTFY_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"topic\":\"$NTFY_TOPIC\",\"priority\":$1,\"tags\":[\"$4\"],\"title\":\"$2\",\"message\":\"$3\"}" "$NTFY_URL"
}

# 1. the Pi 4's last health report
msg="$(timeout "$MQTT_TIMEOUT_S" mosquitto_sub "${mqtt[@]}" -t vega/system/health -C 1 -W 10 2>/dev/null)"
ts="$(printf '%s' "$msg" | sed -n 's/.*"ts":"\([^"]*\)".*/\1/p')"
ok=0
if [ -n "$ts" ] && t="$(date -d "$ts" +%s 2>/dev/null)" && [ $((NOW - t)) -le "$STALE_S" ]; then ok=1; fi

# 2. heartbeat for the Pi 4 (fails quietly while the Pi 4 is down)
timeout "$MQTT_TIMEOUT_S" mosquitto_pub "${mqtt[@]}" -r -t vega/system/watch -m "{\"v\":1,\"ts\":\"$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%SZ)\"}" 2>/dev/null || true

# 3. count failures, push once when the Pi 4 goes and once when it comes back
fails="$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0)"
if [ "$ok" = 1 ]; then
  if [ -f "$STATE_DIR/alerted" ] && push 3 'VEGAS: Pi 4 đã trở lại' 'Pi 4 gửi báo cáo sức khoẻ bình thường trở lại.' white_check_mark; then
    rm -f "$STATE_DIR/alerted"
    echo "pushed: Pi 4 back"
  fi
  echo 0 >"$STATE_DIR/fails"
  exit 0
fi
fails=$((fails + 1))
echo "$fails" >"$STATE_DIR/fails"
echo "Pi 4 health report missing or old ($fails/$FAILS)"
if [ "$fails" -ge "$FAILS" ] && [ ! -f "$STATE_DIR/alerted" ]; then
  if tailscale ping -c 1 --timeout 5s "$PI4_HOST" >/dev/null 2>&1; then
    why='Pi 4 còn trả lời mạng, nhưng MQTT hoặc báo cáo sức khoẻ đã ngừng. Mở Console hoặc SSH vào Pi 4 để xem.'
  else
    why='Pi 4 không trả lời: mất điện, treo, hoặc mất mạng. VEGAS ở nhà đang không chạy.'
  fi
  if push 5 'VEGAS: Pi 4 mất liên lạc' "$why" rotating_light; then
    touch "$STATE_DIR/alerted"
    echo "pushed: Pi 4 down"
  else
    echo "could not reach ntfy: will try again next minute" >&2
  fi
fi
exit 0
