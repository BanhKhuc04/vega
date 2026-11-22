#!/usr/bin/env bash
# Sets up a Raspberry Pi 3 as VEGA's watchdog and phone-alert server (brief 0014). Safe to run again.
#
#   sudo ./infra/pi3/setup.sh
#
# Before: Raspberry Pi OS Lite 64-bit, Tailscale installed and logged in (`sudo tailscale up --hostname=vega-watch`), and
# MQTT_WATCH_PASS from the Pi 4 (`grep MQTT_WATCH_PASS ~/vega/infra/pi/.env` there, after its setup.sh has run).
# It installs ntfy (official apt repository), lets only Tailscale reach it over HTTPS (tailscale serve), creates the ntfy
# accounts `vega` (write) and `phone` (read), and the vega-watch timer. At the end it prints the three lines for the Pi 4's
# brain.env and what to type in the ntfy app on the phone. docs/pi-setup.md, section "Pi 3".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=/etc/vega-watch.env
NTFY_CONF=/etc/ntfy/server.yml
NTFY_PORT=2586
UNITS=/etc/systemd/system

if [ "$(id -u)" != 0 ]; then
  echo "run with sudo: sudo $0" >&2
  exit 1
fi
say() { printf '\n==> %s\n' "$*"; }
# no pipe: under pipefail a missing file (first run) or a closed pipe would end the script
conf_get() { [ -f "$CONF" ] || return 0; sed -n "/^$1=/{s///p;q}" "$CONF"; }
# ntfy's CLI prints to stderr
has_user() { local u; u="$(ntfy user list 2>&1 || true)"; [[ $u == *"user $1 "* ]]; }
conf_set() {
  touch "$CONF"
  chmod 600 "$CONF"
  if grep -q "^$1=" "$CONF"; then sed -i "s|^$1=.*|$1=$2|" "$CONF"; else printf '%s=%s\n' "$1" "$2" >>"$CONF"; fi
}
# write_if_changed <path> <mode>: stdin to path; returns 1 when nothing changed
write_if_changed() {
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if [ -f "$1" ] && cmp -s "$tmp" "$1"; then
    rm -f "$tmp"
    return 1
  fi
  install -D -m "$2" "$tmp" "$1"
  rm -f "$tmp"
}

say "Packages"
apt-get update -y
apt-get install -y ca-certificates curl openssl mosquitto-clients python3
if ! command -v ntfy >/dev/null; then
  # https://docs.ntfy.sh/install/ (Debian/Ubuntu repository)
  mkdir -p /etc/apt/keyrings
  curl -fsSL -o /etc/apt/keyrings/ntfy.gpg https://archive.ntfy.sh/apt/keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/ntfy.gpg] https://archive.ntfy.sh/apt stable main" >/etc/apt/sources.list.d/ntfy.list
  apt-get update -y
  apt-get install -y ntfy
fi

say "Logs in RAM (this Pi writes almost nothing: the SD card lasts)"
if write_if_changed /etc/systemd/journald.conf.d/vega.conf 0644 <<'EOF'; then systemctl restart systemd-journald; fi
[Journal]
Storage=volatile
RuntimeMaxUse=32M
EOF

say "Tailscale"
if ! command -v tailscale >/dev/null || ! tailscale status >/dev/null 2>&1; then
  echo "   Tailscale is not installed or not logged in: curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --hostname=vega-watch" >&2
  exit 1
fi
NAME="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
echo "   this Pi is https://$NAME"

say "Settings ($CONF)"
pi4="$(conf_get PI4_HOST)"
if [ -z "$pi4" ]; then
  read -r -p "   Tailscale name of the Pi 4 [vega]: " pi4
  conf_set PI4_HOST "${pi4:-vega}"
fi
if [ -z "$(conf_get MQTT_PASS)" ]; then
  read -r -s -p "   MQTT_WATCH_PASS from the Pi 4's infra/pi/.env: " pass
  echo
  [ -n "$pass" ] || { echo "   empty: run again when you have it" >&2; exit 1; }
  conf_set MQTT_PASS "$pass"
fi
mosquitto_sub -h "$(conf_get PI4_HOST)" -u watch -P "$(conf_get MQTT_PASS)" -t vega/system/health -C 1 -W 10 >/dev/null ||
  echo "   WARNING: could not read vega/system/health from the Pi 4 (name, password, or its setup.sh not run since M10)" >&2
topic="$(conf_get NTFY_TOPIC)"
if [ -z "$topic" ]; then
  topic="vega-$(openssl rand -hex 8)"
  conf_set NTFY_TOPIC "$topic"
fi
conf_set NTFY_URL "http://127.0.0.1:$NTFY_PORT"

say "ntfy: Tailscale only, accounts required, instant iPhone pushes through ntfy.sh (it sees message ids, not the text)"
install -d -o ntfy -g ntfy /var/lib/ntfy /var/cache/ntfy
if write_if_changed "$NTFY_CONF" 0644 <<EOF; then systemctl restart ntfy; fi
# managed by VEGA infra/pi3/setup.sh
base-url: "https://$NAME"
listen-http: "127.0.0.1:$NTFY_PORT"
behind-proxy: true
auth-file: "/var/lib/ntfy/user.db"
auth-default-access: "deny-all"
cache-file: "/var/cache/ntfy/cache.db"
upstream-base-url: "https://ntfy.sh"
EOF
systemctl enable --now ntfy
sleep 2
if ! has_user vega; then
  # the brain and vega-watch only use a token: this password is never needed
  NTFY_PASSWORD="$(openssl rand -hex 24)" ntfy user add vega
fi
if ! has_user phone; then
  echo "   Choose the password the ntfy app on your phone will use (account 'phone'):"
  ntfy user add phone
fi
ntfy access vega "$topic" write-only >/dev/null
ntfy access phone "$topic" read-only >/dev/null
if [ -z "$(conf_get NTFY_TOKEN)" ]; then
  token="$(ntfy token add --label=vega vega 2>&1 | grep -o 'tk_[A-Za-z0-9]*' | head -n1 || true)"
  [ -n "$token" ] || { echo "   could not create an ntfy token: run 'sudo ntfy token add vega' and put it in $CONF as NTFY_TOKEN=" >&2; exit 1; }
  conf_set NTFY_TOKEN "$token"
fi
tailscale serve --bg "http://127.0.0.1:$NTFY_PORT" >/dev/null || echo "   tailscale serve failed: turn on HTTPS Certificates in the Tailscale admin console (DNS page), then run again" >&2

say "vega-watch every minute"
changed=0
if write_if_changed "$UNITS/vega-watch.service" 0644 <<EOF; then changed=1; fi
# managed by VEGA infra/pi3/setup.sh
[Unit]
Description=VEGA watchdog: is the Pi 4 alive? (infra/pi3/vega-watch.sh)
After=network-online.target tailscaled.service ntfy.service
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=$CONF
ExecStart=/bin/bash $HERE/vega-watch.sh
EOF
if write_if_changed "$UNITS/vega-watch.timer" 0644 <<'EOF'; then changed=1; fi
# managed by VEGA infra/pi3/setup.sh
[Unit]
Description=VEGA watchdog every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF
if [ "$changed" = 1 ]; then systemctl daemon-reload; fi
systemctl enable --now vega-watch.timer

say "Test push"
if curl -fsS -m 10 -o /dev/null -H "Authorization: Bearer $(conf_get NTFY_TOKEN)" -H 'Content-Type: application/json' \
  -d "{\"topic\":\"$topic\",\"priority\":3,\"tags\":[\"wave\"],\"title\":\"VEGA: Pi 3 sẵn sàng\",\"message\":\"Người gác đang trông Pi 4.\"}" "http://127.0.0.1:$NTFY_PORT"; then
  echo "   sent (your phone shows it once subscribed)"
else
  echo "   ntfy did not accept the test push: journalctl -u ntfy" >&2
fi

cat <<EOF

==> Done. Two things left:

1. On the Pi 4, add these three lines to ~/vega/infra/pi/brain.env, then: cd ~/vega/infra/pi && sudo docker compose up -d vega-brain
   (they are secret: do not paste them anywhere else)

NTFY_URL=https://$NAME
NTFY_TOKEN=$(conf_get NTFY_TOKEN)
NTFY_TOPIC=$topic

2. On the iPhone (Tailscale on): App Store › ntfy › Settings › Default server: https://$NAME
   Users › add: server https://$NAME, user phone, the password you chose. Then subscribe to the topic: $topic
EOF
