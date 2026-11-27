#!/usr/bin/env python3
"""VEGA knob: an EC11 rotary encoder with push button on the Pi 4 GPIO, turned into key presses for the mini screen
(dashboard/src/mini). Turn = Down / Up, press = Enter, hold 0.6 s = Escape (back). The keys go through /dev/uinput,
so Chromium in the kiosk sees an ordinary keyboard and the page needs no GPIO access.

Pins (BCM numbers), common pin and the button's other leg to GND, internal pull-ups:
    A = GPIO17 (pin 11), B = GPIO27 (pin 13), button = GPIO22 (pin 15)
Override with VEGA_KNOB_PINS=A,B,SW. Turning goes the wrong way: swap A and B (wires or the variable).
Installed by `infra/pi/setup.sh --mini-screen` as the vega-knob service. Needs python3-gpiozero, python3-lgpio, python3-evdev.
"""

import os
import signal

HOLD_S = 0.6


def main() -> None:
    from evdev import UInput, ecodes as e
    from gpiozero import Button, RotaryEncoder

    a, b, sw = (int(p) for p in os.environ.get("VEGA_KNOB_PINS", "17,27,22").split(","))
    ui = UInput({e.EV_KEY: [e.KEY_UP, e.KEY_DOWN, e.KEY_ENTER, e.KEY_ESC]}, name="vega-knob")

    def tap(code: int) -> None:
        ui.write(e.EV_KEY, code, 1)
        ui.write(e.EV_KEY, code, 0)
        ui.syn()

    knob = RotaryEncoder(a, b, max_steps=0)
    knob.when_rotated_clockwise = lambda: tap(e.KEY_DOWN)
    knob.when_rotated_counter_clockwise = lambda: tap(e.KEY_UP)

    button = Button(sw, pull_up=True, bounce_time=0.03, hold_time=HOLD_S)
    held = False

    def on_held() -> None:
        nonlocal held
        held = True
        tap(e.KEY_ESC)

    def on_released() -> None:
        nonlocal held
        if not held:  # a long press already sent Escape when it reached HOLD_S
            tap(e.KEY_ENTER)
        held = False

    button.when_held = on_held
    button.when_released = on_released
    print(f"vega-knob: A=GPIO{a} B=GPIO{b} button=GPIO{sw}", flush=True)
    signal.pause()


if __name__ == "__main__":
    main()
