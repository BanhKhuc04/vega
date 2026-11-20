#!/usr/bin/env bash
# VEGA on a Raspberry Pi 3 or 4 (Raspberry Pi OS Lite, 64-bit). Safe to run again: every step checks first.
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
  say "zram swap (compressed swap in RAM)"
  # Raspberry Pi OS Trixie sets up zram itself (rpi-swap); zram-tools would then fail on the busy /dev/zram0
  if swapon --noheadings --show=NAME 2>/dev/null | grep -q zram || dpkg -s rpi-swap >/dev/null 2>&1; then
    echo "   provided by the OS, keeping it"
    if systemctl is-enabled zramswap >/dev/null 2>&1; then
      echo "   turning off the extra zramswap service an earlier run installed"
      run systemctl disable --now zramswap || true
      run systemctl reset-failed zramswap || true
    fi
    return
  fi
  run apt-get install -y zram-tools
  if write_if_changed /etc/default/zramswap 0644 <<'CONF'; then
# managed by VEGA infra/pi/setup.sh
ALGO=zstd
PERCENTAGE=50
CONF
    # swap helps a 1 GB Pi 3 but is not required: a failure here must not stop the install
    run systemctl restart zramswap || echo "   zram did not start, carrying on without it"
  fi
  run systemctl enable zramswap || true
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

step_tailscale_ip() {
  say "Tailscale address (dashboard and MQTT WebSocket listen on localhost + Tailscale only)"
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would set TAILSCALE_IP in $ENV_FILE from 'tailscale ip -4'"
    return
  fi
  grep -q '^TAILSCALE_IP=' "$ENV_FILE" || printf 'TAILSCALE_IP=\n' >>"$ENV_FILE"
  if [ -n "$(env_get TAILSCALE_IP)" ]; then
    echo "   TAILSCALE_IP=$(env_get TAILSCALE_IP), keeping it"
    return
  fi
  local ip=""
  if command -v tailscale >/dev/null 2>&1; then ip="$(tailscale ip -4 2>/dev/null | head -n1 || true)"; fi
  if [ -n "$ip" ]; then
    sed -i "s/^TAILSCALE_IP=.*/TAILSCALE_IP=$ip/" "$ENV_FILE"
    echo "   TAILSCALE_IP=$ip"
  else
    echo "   Tailscale not found: dashboard and WebSocket reachable from this Pi only (install Tailscale, then run again)"
  fi
}

step_tailscale_serve() {
  say "HTTPS inside the tailnet (tailscale serve): browsers only allow the microphone on HTTPS"
  local port
  port="$( [ -f "$ENV_FILE" ] && env_get UI_PORT || true )"
  port="${port:-8080}"
  if ! command -v tailscale >/dev/null 2>&1 || ! tailscale status >/dev/null 2>&1; then
    echo "   Tailscale not installed or not logged in: skipped (the dashboard stays http, the mic works on localhost only)"
    return
  fi
  if tailscale serve status 2>/dev/null | grep -q "127.0.0.1:$port"; then
    echo "   already serving:"
    tailscale serve status 2>/dev/null | sed 's/^/   /'
    return
  fi
  # tailnet only (serve, not funnel): nothing is opened to the internet
  if run tailscale serve --bg "http://127.0.0.1:$port"; then
    [ "$DRY" = 1 ] || tailscale serve status 2>/dev/null | sed 's/^/   /'
  else
    echo "   tailscale serve failed: turn on MagicDNS and HTTPS Certificates in the Tailscale admin console (DNS page), then run again"
  fi
}

step_brain_env() {
  say "Brain settings (brain.env: AI providers, budget; never committed)"
  if [ -f "$HERE/brain.env" ]; then
    echo "   $HERE/brain.env exists, keeping it"
  else
    run install -m 600 "$HERE/brain.env.example" "$HERE/brain.env"
  fi
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
  say "Starting the stack (the first build takes 10-20 minutes on a Pi)"
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
step_tailscale_ip
step_brain_env
step_mosquitto_users
step_stack
step_tailscale_serve
if [ "$KIOSK" = 1 ]; then step_kiosk; fi
say "Done. Dashboard: http://$( [ -f "$ENV_FILE" ] && [ -n "$(env_get TAILSCALE_IP)" ] && env_get TAILSCALE_IP || echo localhost ):$( [ -f "$ENV_FILE" ] && env_get UI_PORT || echo 8080 )/"
