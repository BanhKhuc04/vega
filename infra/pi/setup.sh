#!/usr/bin/env bash
# VEGA on a Raspberry Pi 3 (Raspberry Pi OS Lite, 64-bit). Safe to run again: every step checks first.
#
#   sudo ./infra/pi/setup.sh               # Docker, zram, secrets, stack, Chromium kiosk
#   sudo ./infra/pi/setup.sh --no-kiosk    # everything except the kiosk
#   ./infra/pi/setup.sh --dry-run          # print what would be done, change nothing
#
# Written and syntax-checked off the Pi; the first real run is the owner's (see docs/pi-setup.md).
set -euo pipefail

DRY=0
KIOSK=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-kiosk) KIOSK=0 ;;
    -h | --help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE=(docker compose -f "$HERE/docker-compose.yml" --env-file "$ENV_FILE")
KIOSK_URL="${KIOSK_URL:-http://localhost:8080/?quality=css}"
KIOSK_USER="${KIOSK_USER:-${SUDO_USER:-pi}}"

say() { printf '\n==> %s\n' "$*"; }
run() {
  if [ "$DRY" = 1 ]; then
    printf '   [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# write_if_changed <path> <mode> : content on stdin. Returns 0 if the file changed.
write_if_changed() {
  local path="$1" mode="$2" tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    rm -f "$tmp"
    return 1
  fi
  if [ "$DRY" = 1 ]; then
    printf '   [dry-run] would write %s\n' "$path"
    rm -f "$tmp"
    return 0
  fi
  install -m "$mode" "$tmp" "$path"
  rm -f "$tmp"
  return 0
}

need_root() {
  if [ "$DRY" = 0 ] && [ "$(id -u)" -ne 0 ]; then
    echo "run as root: sudo $0 $*" >&2
    exit 1
  fi
}

random_hex() { openssl rand -hex 16; }

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }

step_packages() {
  say "Base packages"
  run apt-get update -y
  run apt-get install -y ca-certificates curl openssl
}

step_docker() {
  say "Docker"
  if command -v docker >/dev/null 2>&1; then
    echo "   docker already installed: $(docker --version)"
  else
    run sh -c 'curl -fsSL https://get.docker.com | sh'
  fi
  if ! docker compose version >/dev/null 2>&1; then
    run apt-get install -y docker-compose-plugin
  fi
  run systemctl enable --now docker
}

step_zram() {
  say "zram swap (the Pi 3 has 1 GB of RAM)"
  run apt-get install -y zram-tools
  if write_if_changed /etc/default/zramswap 0644 <<'CONF'; then
# managed by VEGA infra/pi/setup.sh
ALGO=zstd
PERCENTAGE=50
CONF
    run systemctl restart zramswap
  fi
  run systemctl enable zramswap
}

step_env() {
  say "Secrets (.env, never committed)"
  if [ -f "$ENV_FILE" ]; then
    echo "   $ENV_FILE exists, keeping it"
    return
  fi
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would create $ENV_FILE with random passwords"
    return
  fi
  local tmp
  tmp="$(mktemp)"
  while IFS= read -r line; do
    case "$line" in
      MQTT_*_PASS=change-me) printf '%s=%s\n' "${line%%=*}" "$(random_hex)" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done <"$HERE/.env.example" >"$tmp"
  install -m 600 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
  echo "   created $ENV_FILE"
}

step_mosquitto_users() {
  say "Mosquitto users"
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would (re)build mosquitto/passwd for users brain, ui, device from .env"
    return
  fi
  local pw="$HERE/mosquitto/passwd" user key
  : >"$pw"
  for user in brain ui device; do
    key="MQTT_$(printf '%s' "$user" | tr '[:lower:]' '[:upper:]')_PASS"
    docker run --rm -v "$HERE/mosquitto:/work" eclipse-mosquitto:2 \
      mosquitto_passwd -b /work/passwd "$user" "$(env_get "$key")"
  done
  # the container runs mosquitto as uid 1883
  chown 1883:1883 "$pw" "$HERE/mosquitto/acl" 2>/dev/null || true
  chmod 640 "$pw"
}

step_stack() {
  say "Starting the stack (the first build of vega-ui takes a few minutes on a Pi 3)"
  run "${COMPOSE[@]}" up -d --build
}

step_kiosk() {
  say "Chromium kiosk -> $KIOSK_URL"
  local chromium=chromium
  if ! apt-cache show chromium >/dev/null 2>&1 && apt-cache show chromium-browser >/dev/null 2>&1; then
    chromium='chromium-browser'
  fi
  run apt-get install -y --no-install-recommends cage "$chromium" seatd
  run usermod -aG video,render,input,seat "$KIOSK_USER" || true
  if write_if_changed /etc/systemd/system/vega-kiosk.service 0644 <<UNIT; then
# managed by VEGA infra/pi/setup.sh
[Unit]
Description=VEGA kiosk (Chromium in a Wayland kiosk compositor)
After=docker.service network-online.target systemd-user-sessions.service
Wants=network-online.target

[Service]
User=$KIOSK_USER
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
Environment=XDG_RUNTIME_DIR=/run/user/%U
ExecStartPre=/bin/sh -c 'until curl -fs ${KIOSK_URL%%\?*} >/dev/null; do sleep 2; done'
ExecStart=/usr/bin/cage -s -- /usr/bin/$chromium --kiosk --ozone-platform=wayland --noerrdialogs --disable-infobars --incognito --no-first-run --disable-session-crashed-bubble --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required "$KIOSK_URL"
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
UNIT
    run systemctl daemon-reload
  fi
  run systemctl enable vega-kiosk.service
  run systemctl set-default graphical.target
  echo "   reboot to start the kiosk:  sudo reboot"
}

need_root "$@"
step_packages
step_docker
step_zram
step_env
step_mosquitto_users
step_stack
if [ "$KIOSK" = 1 ]; then step_kiosk; fi
say "Done. Dashboard: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$( [ -f "$ENV_FILE" ] && env_get UI_PORT || echo 8080 )/"
