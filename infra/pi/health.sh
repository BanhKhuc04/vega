#!/usr/bin/env bash
# Every container of the VEGA stack, published retained on vega/system/health once a minute (brief 0013 B5) by the
# vega-health systemd timer. The brain raises an Alert from it (down, unhealthy, restarting); it never gets the Docker socket.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE=(docker compose -f "$HERE/docker-compose.yml" --env-file "$ENV_FILE")

ids="$("${COMPOSE[@]}" ps -aq)"
services=""
if [ -n "$ids" ]; then
  # docker's own templates build the JSON: no jq needed on the Pi
  # shellcheck disable=SC2086
  services="$(docker inspect --format '{"name":"{{index .Config.Labels "com.docker.compose.service"}}","state":"{{.State.Status}}","health":"{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}","restarts":{{.RestartCount}}}' $ids | paste -sd, -)"
fi
msg="{\"v\":1,\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"services\":[${services}]}"
"${COMPOSE[@]}" exec -T mosquitto mosquitto_pub -u health -P "$(sed -n 's/^MQTT_HEALTH_PASS=//p' "$ENV_FILE" | head -n1)" -r -t vega/system/health -m "$msg"
