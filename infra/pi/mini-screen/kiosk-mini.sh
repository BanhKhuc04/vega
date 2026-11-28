#!/bin/sh
# VEGA kiosk on the small SPI screen (docs/mini-screen.md): cage draws in software (pixman; the SPI panel has no GPU)
# and only on the mi0283qt DRM card, so HDMI stays free. Arguments: the browser command line.
# Installed by `infra/pi/setup.sh --mini-screen` as /usr/local/bin/vega-kiosk-mini.
set -eu

card=""
for c in /sys/class/drm/card[0-9] /sys/class/drm/card[0-9][0-9]; do
  [ -e "$c/device/driver" ] || continue
  case "$(readlink -f "$c/device/driver")" in
    *mi0283qt*) card="/dev/dri/${c##*/}" ;;
  esac
done
if [ -z "$card" ]; then
  echo "vega-kiosk-mini: no mi0283qt display found (check the wiring and dtoverlay=vega-ili9341 in config.txt)" >&2
  exit 1
fi

export WLR_DRM_DEVICES="$card" WLR_RENDERER=pixman WLR_NO_HARDWARE_CURSORS=1
exec /usr/bin/cage -s -- "$@"
