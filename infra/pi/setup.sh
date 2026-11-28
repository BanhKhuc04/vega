#!/usr/bin/env bash
# VEGA on a Raspberry Pi 3 or 4 (Raspberry Pi OS Lite, 64-bit). Safe to run again: every step checks first.
#
#   sudo ./infra/pi/setup.sh               # Docker, zram, secrets, stack, Chromium kiosk
#   sudo ./infra/pi/setup.sh --no-kiosk    # everything except the kiosk
#   sudo ./infra/pi/setup.sh --mini-screen # kiosk on the 2.8" SPI screen with the rotary knob (docs/mini-screen.md)
#   ./infra/pi/setup.sh --dry-run          # print what would be done, change nothing
#   sudo ./infra/pi/setup.sh --restore vega-YYYYMMDD-HHMMSS.tar.gz.age   # rebuild from a backup (M8, docs/pi-setup.md)
#
# Written and syntax-checked off the Pi; the first real run is the owner's (see docs/pi-setup.md).
set -euo pipefail

DRY=0
KIOSK=1
MINI=0
RESTORE=""
want_restore=0
for arg in "$@"; do
  if [ "$want_restore" = 1 ]; then
    RESTORE="$arg"
    want_restore=0
    continue
  fi
  case "$arg" in
    --dry-run) DRY=1 ;;
    --no-kiosk) KIOSK=0 ;;
    --mini-screen) MINI=1 ;;
    --restore) want_restore=1 ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done
if [ "$want_restore" = 1 ] || { [ -n "$RESTORE" ] && [ ! -f "$RESTORE" ]; }; then
  echo "--restore needs an existing backup file (vega-*.tar.gz.age)" >&2
  exit 2
fi
if [ -n "$RESTORE" ]; then RESTORE="$(cd "$(dirname "$RESTORE")" && pwd)/$(basename "$RESTORE")"; fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/.env"
COMPOSE=(docker compose -f "$HERE/docker-compose.yml" --env-file "$ENV_FILE")
if [ "$MINI" = 1 ]; then
  KIOSK_URL="${KIOSK_URL:-http://localhost:8080/mini}"
else
  KIOSK_URL="${KIOSK_URL:-http://localhost:8080/?quality=css}"
fi
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
UNITS=/etc/systemd/system
RESTORED=""

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | head -n1; }

step_packages() {
  say "Base packages"
  run apt-get update -y
  # age encrypts the backups, rclone copies one off the Pi (M8)
  run apt-get install -y ca-certificates curl openssl age rclone
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
      MQTT_*_PASS=change-me | CONSOLE_TOKEN=change-me) printf '%s=%s\n' "${line%%=*}" "$(random_hex)" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done <"$HERE/.env.example" >"$tmp"
  install -m 600 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
  echo "   created $ENV_FILE"
}

# A .env from before a milestone lacks its new settings: add them, with fresh random passwords and tokens.
step_env_upgrade() {
  say "New settings in .env"
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would add the keys of .env.example missing from $ENV_FILE"
    return
  fi
  local line key added=0
  while IFS= read -r line; do
    case "$line" in '#'* | '') continue ;; esac
    key="${line%%=*}"
    if grep -q "^$key=" "$ENV_FILE"; then continue; fi
    case "$line" in
      MQTT_*_PASS=change-me | CONSOLE_TOKEN=change-me) printf '%s=%s\n' "$key" "$(random_hex)" >>"$ENV_FILE" ;;
      *) printf '%s\n' "$line" >>"$ENV_FILE" ;;
    esac
    echo "   added $key"
    added=1
  done <"$HERE/.env.example"
  if [ "$added" = 0 ]; then echo "   nothing new"; fi
}

# The backup key (M8): the public half stays in .env, the private half is shown once and kept only by the owner.
step_age_key() {
  say "Backup encryption key (age)"
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would create an age key (if AGE_RECIPIENT is empty) and print its private half once"
    return
  fi
  if [ -n "$(env_get AGE_RECIPIENT)" ]; then
    echo "   AGE_RECIPIENT is set, keeping it"
    return
  fi
  local key pub
  key="$(mktemp -u)"
  age-keygen -o "$key" 2>/dev/null
  pub="$(sed -n 's/^# public key: //p' "$key")"
  sed -i "s|^AGE_RECIPIENT=.*|AGE_RECIPIENT=$pub|" "$ENV_FILE"
  echo
  echo "   ##########################################################################################"
  echo "   #  PRIVATE BACKUP KEY, shown only now. Save it in your password manager AND as a file on #"
  echo "   #  your PC (vega-backup-key.txt). Without it no backup can be read. It is not kept here. #"
  echo "   ##########################################################################################"
  sed 's/^/   /' "$key"
  echo
  shred -u "$key" 2>/dev/null || rm -f "$key"
}

# --restore, part 1: the old Pi's secrets (passwords, AI keys, Google token, backup key) before anything reads .env
step_restore_files() {
  say "Restore: decrypting $RESTORE"
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would decrypt it and put back .env, brain.env, mosquitto/passwd"
    return
  fi
  local keyfile="${AGE_KEY:-}" f
  if [ -z "$keyfile" ]; then read -r -p "   Path of the private backup key file (vega-backup-key.txt): " keyfile; fi
  if [ ! -f "$keyfile" ]; then
    echo "   key file not found: $keyfile" >&2
    exit 1
  fi
  RESTORED="$(mktemp -d)"
  chmod 700 "$RESTORED"
  trap 'rm -rf "$RESTORED"' EXIT
  age -d -i "$keyfile" "$RESTORE" | tar -xzf - -C "$RESTORED"
  for f in .env brain.env mosquitto/passwd; do
    [ -f "$RESTORED/infra/$f" ] || continue
    if [ -f "$HERE/$f" ]; then cp "$HERE/$f" "$HERE/$f.before-restore"; fi
    install -m 600 "$RESTORED/infra/$f" "$HERE/$f"
    echo "   restored $f"
  done
  # rclone's config holds the Drive token: without it the rebuilt Pi stops copying backups off the Pi
  if [ -f "$RESTORED/infra/rclone.conf" ]; then
    local rconf="${RCLONE_CONFIG:-$(rclone config file 2>/dev/null | tail -n1)}"
    if [ -f "$rconf" ]; then cp "$rconf" "$rconf.before-restore"; fi
    install -d -m 700 "$(dirname "$rconf")"
    install -m 600 "$RESTORED/infra/rclone.conf" "$rconf"
    echo "   restored rclone.conf"
  fi
  # the new install may get another Tailscale address: find it again
  sed -i 's/^TAILSCALE_IP=.*/TAILSCALE_IP=/' "$ENV_FILE"
}

# --restore, part 2: brain.db (reminders, command log, cost ledger) into the brain's volume before the brain starts
step_restore_db() {
  if [ -z "$RESTORE" ]; then return 0; fi
  say "Restore: the brain's database"
  if [ "$DRY" = 1 ]; then
    echo "   [dry-run] would copy brain.db (and google-token.json) into the vega-brain volume"
    return
  fi
  local f
  "${COMPOSE[@]}" build vega-brain
  "${COMPOSE[@]}" create vega-brain
  for f in brain.db google-token.json; do
    [ -f "$RESTORED/$f" ] || continue
    chown 1000:1000 "$RESTORED/$f" # the brain runs as node (uid 1000)
    chmod 600 "$RESTORED/$f"
    "${COMPOSE[@]}" cp "$RESTORED/$f" "vega-brain:/data/$f"
    echo "   restored $f"
  done
}

# Nightly backup at 03:30 and the health report every minute (M8)
step_timers() {
  say "Timers: backup every night at 03:30, health report every minute"
  local changed=0
  if write_if_changed "$UNITS/vega-backup.service" 0644 <<UNIT; then changed=1; fi
# managed by VEGA infra/pi/setup.sh
[Unit]
Description=VEGA backup (infra/pi/backup.sh)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash $HERE/backup.sh
UNIT
  if write_if_changed "$UNITS/vega-backup.timer" 0644 <<'UNIT'; then changed=1; fi
# managed by VEGA infra/pi/setup.sh
[Unit]
Description=VEGA backup every night

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
UNIT
  if write_if_changed "$UNITS/vega-health.service" 0644 <<UNIT; then changed=1; fi
# managed by VEGA infra/pi/setup.sh
[Unit]
Description=VEGA health report (infra/pi/health.sh)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash $HERE/health.sh
UNIT
  if write_if_changed "$UNITS/vega-health.timer" 0644 <<'UNIT'; then changed=1; fi
# managed by VEGA infra/pi/setup.sh
[Unit]
Description=VEGA health report every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT
  if [ "$changed" = 1 ]; then run systemctl daemon-reload; fi
  run systemctl enable --now vega-backup.timer vega-health.timer
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
    echo "   [dry-run] would (re)build mosquitto/passwd for users brain, ui, device, health, phone, watch, agent from .env"
    return
  fi
  local pw="$HERE/mosquitto/passwd" user key
  : >"$pw"
  for user in brain ui device health phone watch agent; do
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
  # mosquitto reads passwd and acl only when it starts: new users (M8: health, phone; M10: watch; agent) need a restart
  run "${COMPOSE[@]}" restart mosquitto
}

step_kiosk() {
  say "Chromium kiosk -> $KIOSK_URL"
  local chromium=chromium
  if ! apt-cache show chromium >/dev/null 2>&1 && apt-cache show chromium-browser >/dev/null 2>&1; then
    chromium='chromium-browser'
  fi
  run apt-get install -y --no-install-recommends cage "$chromium" seatd
  run usermod -aG video,render,input,seat "$KIOSK_USER" || true
  local browser="/usr/bin/$chromium --kiosk --ozone-platform=wayland --noerrdialogs --disable-infobars --incognito --no-first-run --disable-session-crashed-bubble --overscroll-history-navigation=0 --autoplay-policy=no-user-gesture-required"
  local start="/usr/bin/cage -s -- $browser"
  # the SPI screen: software drawing at 320x240, on that panel only (mini-screen/kiosk-mini.sh)
  if [ "$MINI" = 1 ]; then start="/usr/local/bin/vega-kiosk-mini $browser --disable-gpu --force-device-scale-factor=1"; fi
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
ExecStart=$start "$KIOSK_URL"
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

# The 2.8" ILI9341 SPI screen and the EC11 knob of the homeserver box (docs/mini-screen.md, files in mini-screen/)
step_mini_screen() {
  say "Mini screen: 2.8\" SPI display + rotary knob"
  run apt-get install -y --no-install-recommends device-tree-compiler python3-gpiozero python3-lgpio python3-evdev
  local boot=/boot/firmware
  [ -d "$boot" ] || boot=/boot
  run dtc -@ -q -I dts -O dtb -o "$boot/overlays/vega-ili9341.dtbo" "$HERE/mini-screen/vega-ili9341.dts"
  if ! grep -qx 'dtoverlay=vega-ili9341' "$boot/config.txt"; then
    if [ "$DRY" = 1 ]; then
      printf '   [dry-run] would add dtparam=spi=on and dtoverlay=vega-ili9341 to %s\n' "$boot/config.txt"
    else
      printf '\n# VEGA mini screen (infra/pi/setup.sh --mini-screen)\n[all]\ndtparam=spi=on\ndtoverlay=vega-ili9341\n' >>"$boot/config.txt"
    fi
  fi
  run install -m 0755 "$HERE/mini-screen/knob.py" /usr/local/bin/vega-knob
  run install -m 0755 "$HERE/mini-screen/kiosk-mini.sh" /usr/local/bin/vega-kiosk-mini
  if write_if_changed /etc/systemd/system/vega-knob.service 0644 <<'UNIT'; then
# managed by VEGA infra/pi/setup.sh
[Unit]
Description=VEGA knob (rotary encoder -> keys for the mini screen)
After=multi-user.target

[Service]
ExecStartPre=/sbin/modprobe uinput
ExecStart=/usr/bin/python3 /usr/local/bin/vega-knob
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    run systemctl daemon-reload
  fi
  run systemctl enable vega-knob.service
  echo "   reboot to load the display overlay:  sudo reboot"
}

need_root "$@"
step_packages
step_docker
step_zram
if [ -n "$RESTORE" ]; then step_restore_files; fi
step_env
step_env_upgrade
step_age_key
step_tailscale_ip
step_brain_env
step_mosquitto_users
step_restore_db
step_stack
step_timers
step_tailscale_serve
if [ "$MINI" = 1 ]; then step_mini_screen; fi
if [ "$KIOSK" = 1 ]; then step_kiosk; fi
say "Done. Dashboard: http://$( [ -f "$ENV_FILE" ] && [ -n "$(env_get TAILSCALE_IP)" ] && env_get TAILSCALE_IP || echo localhost ):$( [ -f "$ENV_FILE" ] && env_get UI_PORT || echo 8080 )/"
