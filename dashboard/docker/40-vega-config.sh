#!/bin/sh
# Writes /usr/share/nginx/html/config.js from the container environment (runs at start-up, before nginx).
set -eu
out=/usr/share/nginx/html/config.js
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
{
  printf 'window.__VEGA__ = {\n'
  [ -n "${VEGA_SOURCE:-}" ] && printf '  source: "%s",\n' "$(esc "$VEGA_SOURCE")"
  [ -n "${VEGA_MQTT_URL:-}" ] && printf '  mqttUrl: "%s",\n' "$(esc "$VEGA_MQTT_URL")"
  [ -n "${VEGA_MQTT_USER:-}" ] && printf '  username: "%s",\n' "$(esc "$VEGA_MQTT_USER")"
  [ -n "${VEGA_MQTT_PASS:-}" ] && printf '  password: "%s",\n' "$(esc "$VEGA_MQTT_PASS")"
  [ -n "${VEGA_ROOM:-}" ] && printf '  room: "%s",\n' "$(esc "$VEGA_ROOM")"
  printf '};\n'
} > "$out"
