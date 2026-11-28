#!/usr/bin/env bash
# Sets up a Raspberry Pi 3 as VEGA's watchdog and phone-alert server (brief 0014). Safe to run again.
#
#   sudo ./infra/pi3/setup.sh
#   sudo ./infra/pi3/setup.sh --ops    # also the ops station (brief 0017): Uptime Kuma, Tailscale gateway, log book
#
# Before: Raspberry Pi OS Lite 64-bit, Tailscale installed and logged in (`sudo tailscale up --hostname=vega-watch`), and
# MQTT_WATCH_PASS from the Pi 4 (`grep MQTT_WATCH_PASS ~/vega/infra/pi/.env` there, after its setup.sh has run).
# It installs ntfy (official apt repository), lets only Tailscale reach it over HTTPS (tailscale serve), creates the ntfy
# accounts `vega` (write) and `phone` (read), and the vega-watch timer. At the end it prints the three lines for the Pi 4's
# brain.env and what to type in the ntfy app on the phone. docs/pi-setup.md, section "Pi 3".
set -euo pipefail

OPS=0
for arg in "$@"; do
  case "$arg" in
    --ops) OPS=1 ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=/etc/vega-watch.env
NTFY_CONF=/etc/ntfy/server.yml
NTFY_PORT=2586
UNITS=/etc/systemd/system
KUMA_VERSION=2.5.12
KUMA_DIR=/opt/uptime-kuma
KUMA_DATA=/var/lib/uptime-kuma
KUMA_PORT=3001
KUMA_HTTPS=8443

if [ "$(id -u)" != 0 ]; then
  echo "run with sudo: sudo $0 $*" >&2
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

if [ "$OPS" = 1 ]; then
  say "Ops station packages (brief 0017)"
  apt-get install -y --no-install-recommends git nodejs npm iputils-ping rsyslog logrotate

  say "Uptime Kuma $KUMA_VERSION (no Docker: about 100-150 MB instead of 200+)"
  id -u kuma >/dev/null 2>&1 || useradd --system --home-dir "$KUMA_DATA" --create-home --shell /usr/sbin/nologin kuma
  if [ "$(cat "$KUMA_DIR/.vega-version" 2>/dev/null || true)" != "$KUMA_VERSION" ]; then
    systemctl stop uptime-kuma 2>/dev/null || true
    # code only: the monitors and their history live in $KUMA_DATA and survive this
    rm -rf "$KUMA_DIR"
    git clone -q --depth 1 --branch "$KUMA_VERSION" https://github.com/louislam/uptime-kuma.git "$KUMA_DIR"
    chown -R kuma:kuma "$KUMA_DIR"
    echo "   npm install: 5-15 minutes on a Pi 3"
    (cd "$KUMA_DIR" && runuser -u kuma -- env HOME="$KUMA_DATA" npm ci --omit dev --no-audit --no-fund &&
      runuser -u kuma -- env HOME="$KUMA_DATA" npm run download-dist)
    rm -rf "$KUMA_DATA/.npm"
    echo "$KUMA_VERSION" >"$KUMA_DIR/.vega-version"
  fi
  if write_if_changed "$UNITS/uptime-kuma.service" 0644 <<EOF; then systemctl daemon-reload; systemctl restart uptime-kuma 2>/dev/null || true; fi
# managed by VEGA infra/pi3/setup.sh (brief 0017)
[Unit]
Description=Uptime Kuma: which part of the house is down
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=kuma
Group=kuma
WorkingDirectory=$KUMA_DIR
Environment=NODE_ENV=production UPTIME_KUMA_HOST=127.0.0.1 UPTIME_KUMA_PORT=$KUMA_PORT DATA_DIR=$KUMA_DATA/ NODE_OPTIONS=--max-old-space-size=128
ExecStart=/usr/bin/node server/server.js
Restart=on-failure
RestartSec=10
# the Pi 3 RAM budget (brief 0016 T4): the watchdog and ntfy must keep running whatever Kuma does
MemoryHigh=200M
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF
  systemctl enable --now uptime-kuma
  tailscale serve --bg --https="$KUMA_HTTPS" "http://127.0.0.1:$KUMA_PORT" >/dev/null || echo "   tailscale serve for Uptime Kuma failed" >&2
  if ! has_user kuma; then NTFY_PASSWORD="$(openssl rand -hex 24)" ntfy user add kuma; fi
  ntfy access kuma "$topic" write-only >/dev/null
  if [ -z "$(conf_get KUMA_NTFY_TOKEN)" ]; then
    token="$(ntfy token add --label=kuma kuma 2>&1 | grep -o 'tk_[A-Za-z0-9]*' | head -n1 || true)"
    [ -n "$token" ] && conf_set KUMA_NTFY_TOKEN "$token"
  fi

  say "Tailscale gateway: the home LAN from anywhere (subnet router) and an exit node"
  dev="$(ip -4 route show default | awk '{print $5; exit}')"
  lan="$(python3 -c 'import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)' "$(ip -4 -o addr show dev "$dev" | awk '{print $4; exit}')")"
  if write_if_changed /etc/sysctl.d/99-vega-tailscale.conf 0644 <<'EOF'; then systemctl restart systemd-sysctl; fi
# managed by VEGA infra/pi3/setup.sh: Tailscale subnet router and exit node (brief 0017 O7)
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
  tailscale set --advertise-routes="$lan" --advertise-exit-node
  echo "   advertising $lan and an exit node: approve both in the Tailscale admin console (Machines > vega-watch > Edit route settings)"

  say "Log book: the Pi 4 (Tailscale, TCP) and the router (LAN, UDP) into /var/log/remote"
  # replaces Debian's rsyslog.conf: this Pi's own logs stay in the RAM journal, so nothing local is written to the SD card
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
# managed by VEGA infra/pi3/setup.sh (brief 0017 O8): receives other machines' logs, writes nothing of this Pi's own
global(workDirectory="/var/lib/rsyslog")
module(load="imtcp" MaxSessions="20")
module(load="imudp")
\$AllowedSender TCP, 127.0.0.1, 100.64.0.0/10
\$AllowedSender UDP, 127.0.0.1, $lan
input(type="imtcp" port="514" ruleset="remote")
input(type="imudp" port="514" ruleset="remote")
# the sender names the file: secpath-replace keeps a forged hostname inside /var/log/remote
template(name="vegaRemoteFile" type="string" string="/var/log/remote/%HOSTNAME:::secpath-replace%.log")
ruleset(name="remote") {
  action(type="omfile" dynaFile="vegaRemoteFile" dynaFileCacheSize="10" dirCreateMode="0700" fileCreateMode="0600")
}
EOF
  if rsyslogd -N1 -f "$tmp" >/dev/null 2>&1; then
    if write_if_changed /etc/rsyslog.conf 0644 <"$tmp"; then systemctl restart rsyslog; fi
  else
    echo "   rsyslog refused the new config, keeping the old one:" >&2
    rsyslogd -N1 -f "$tmp" >&2 || true
  fi
  rm -f "$tmp"
  systemctl enable --now rsyslog
  write_if_changed /etc/logrotate.d/vega-remote 0644 <<'EOF' || true
# managed by VEGA infra/pi3/setup.sh: at most 3 files of 20 MB per machine (brief 0016 T5)
/var/log/remote/*.log {
  size 20M
  rotate 2
  compress
  delaycompress
  missingok
  notifempty
  postrotate
    /usr/lib/rsyslog/rsyslog-rotate
  endscript
}
EOF
  # the size cap needs a check more often than once a day
  if write_if_changed /etc/systemd/system/logrotate.timer.d/vega.conf 0644 <<'EOF'; then systemctl daemon-reload; systemctl restart logrotate.timer; fi
[Timer]
OnCalendar=
OnCalendar=hourly
EOF
fi

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

if [ "$OPS" = 1 ]; then
  cat <<EOF2

==> Ops station (brief 0017). In a browser with Tailscale on:

3. https://$NAME:$KUMA_HTTPS  create the Uptime Kuma account, then Settings > Notifications > Setup Notification:
   type ntfy, server URL http://127.0.0.1:$NTFY_PORT, topic $topic, priority 4, access token $(conf_get KUMA_NTFY_TOKEN)
   Settings > Monitor History: 30 days. Monitors: docs/pi-setup.md, section "Pi 3: trạm điều hành (P3.1)".

4. Tailscale admin console > Machines > vega-watch > Edit route settings: approve the subnet route and "Use as exit node".

5. On the Pi 4: LOG_HOST=$(tailscale ip -4 | head -n1) in ~/vega/infra/pi/.env, then sudo ./infra/pi/setup.sh --no-kiosk
EOF2
fi
