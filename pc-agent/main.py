"""pc-agent: "Hey Vegas" on this PC (brief 0009).

    python pc-agent/main.py                 # listen to the microphone (settings: pc-agent/.env)
    python pc-agent/main.py --wav file.wav  # feed a 16 kHz mono WAV instead of the mic, stop after one answer (tests)

Ctrl+Alt+M (HOTKEY) closes the microphone and opens it again.
"""

import argparse
import io
import json
import os
import queue
import sys
import threading
import time
import uuid
import wave
from datetime import datetime, timezone
from urllib.parse import urlsplit

import numpy as np

from agent import FRAME, RATE, Agent, Config, Robot, get_tts, lang_of, load_env_file, post_stt

HERE = os.path.dirname(os.path.abspath(__file__))
COMMAND = "vega/system/command"
RESULT = "vega/system/events/command_result"
CORE = "vega/desk/core/state"


def log(msg):
    print(f"{datetime.now():%H:%M:%S} {msg}", flush=True)


def wake_model(name):
    """openWakeWord with one model: a file (`models/hey_vega.onnx`) or a built-in name (downloaded once)."""
    import openwakeword
    from openwakeword.model import Model
    from openwakeword.utils import download_models

    path = name if name.endswith(".onnx") else None
    if path and not os.path.isabs(path):
        path = os.path.join(HERE, path)
    # the named model plus the shared melspectrogram / embedding / VAD models, once (an empty list would fetch every model)
    download_models([name] if not path else ["\x00"])  # "\x00" matches no built-in model
    m = Model(wakeword_models=[path or name], inference_framework="onnx")
    key = next(iter(m.models))
    log(f"[agent] wake word model: {key} (built-in names: {', '.join(openwakeword.MODELS)})")
    return (lambda f: float(m.predict(f)[key])), m.reset


class Bus:
    """MQTT: publish commands (via voice) and the mic state, wait for command_result of our own ids."""

    def __init__(self, cfg):
        import paho.mqtt.client as mqtt

        u = urlsplit(cfg.mqtt_url)
        ws = u.scheme in ("ws", "wss")
        self.c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"vega-pc-agent-{uuid.uuid4().hex[:6]}", transport="websockets" if ws else "tcp")
        if ws:
            self.c.ws_set_options(path=u.path or "/mqtt")
        if u.scheme in ("wss", "mqtts"):
            self.c.tls_set()
        if cfg.mqtt_user:
            self.c.username_pw_set(cfg.mqtt_user, cfg.mqtt_pass)
        self.waiting = {}
        self.lock = threading.Lock()
        self.mic = "on"
        self.state = "idle"
        self.connected = threading.Event()
        self.c.on_connect = lambda c, *_: (c.subscribe(RESULT), self.publish_core(), self.connected.set(), log(f"[agent] connected to {cfg.mqtt_url}"))
        self.c.on_message = self.on_message
        self.c.reconnect_delay_set(1, 10)
        self.c.connect_async(u.hostname, u.port or (443 if u.scheme == "wss" else 80 if ws else 1883))
        self.c.loop_start()

    def on_message(self, _c, _u, msg):
        try:
            r = json.loads(msg.payload)
        except ValueError:
            return
        with self.lock:
            w = self.waiting.get(r.get("id"))
        if w:
            w[1].update(r)
            w[0].set()

    def ask(self, text, timeout=30):
        cid = f"VOICE-{uuid.uuid4().hex[:10]}"
        done, out = threading.Event(), {}
        with self.lock:
            self.waiting[cid] = (done, out)
        ts = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        self.c.publish(COMMAND, json.dumps({"v": 1, "id": cid, "text": text[:500], "ts": ts, "via": "voice"}, ensure_ascii=False))
        ok = done.wait(timeout)
        with self.lock:
            self.waiting.pop(cid, None)
        return out if ok else None

    def publish_core(self, state=None, mic=None):
        self.state, self.mic = state or self.state, mic or self.mic
        self.c.publish(CORE, json.dumps({"v": 1, "state": self.state, "mic": self.mic}), retain=True)


def player():
    """beep(kind) and speak(wav bytes) on the default output device."""
    import sounddevice as sd

    def tone(hz, ms):
        t = np.arange(int(RATE * ms / 1000)) / RATE
        return (0.25 * np.sin(2 * np.pi * hz * t) * np.minimum(1, (len(t) - np.arange(len(t))) / 400)).astype(np.float32)

    beeps = {"wake": tone(880, 120), "error": np.concatenate([tone(440, 120), tone(330, 160)])}

    def beep(kind):
        sd.play(beeps[kind], RATE)
        sd.wait()

    def play_wav(data):
        with wave.open(io.BytesIO(data)) as w:
            a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
            sd.play(a, w.getframerate())
            sd.wait()

    return beep, play_wav


def local_voice(cfg):
    """VieNeu-TTS on this PC (VOICE_LOCAL), loaded in the background (~40 s): {"say": say(text) -> bool} once ready.
    say() streams the voice to the speakers as it is generated; False when nothing could be played (then Piper speaks)."""
    ready = {}
    if not cfg.voice_local:
        return ready

    def load():
        try:
            import sounddevice as sd
            from vieneu import Vieneu

            t = time.time()
            tts = Vieneu(precision="int8")  # int8 needs AVX-VNNI (12th-gen Intel has it); fp32 is ~1.6x slower
            rate = tts.sample_rate

            def say(text):
                # generated in its own thread, ahead of playback: out.write() returns once the chunk fits the sound card's
                # small buffer, so generating the next chunk between writes would leave the speaker empty (stutter)
                fx = Robot(rate, cfg.voice_robot)
                q, failed = queue.Queue(), []

                def produce():
                    try:
                        for chunk in tts.infer_stream(text, voice=cfg.voice_local):
                            q.put(fx(chunk))
                    except Exception as e:  # noqa: BLE001
                        failed.append(e)
                    finally:
                        q.put(None)

                threading.Thread(target=produce, daemon=True).start()
                head, have, chunk = [], 0, None
                while have < rate * 0.4 and (chunk := q.get()) is not None:  # 0.4 s ahead before the speaker starts
                    head.append(chunk)
                    have += len(chunk)
                if not head:
                    if failed:
                        raise failed[0]
                    return False
                gaps = 0
                with sd.OutputStream(samplerate=rate, channels=1, dtype="float32", latency="high") as out:
                    for c in head:
                        gaps += out.write(c)
                    while chunk is not None and (chunk := q.get()) is not None:
                        gaps += out.write(chunk)
                if gaps:
                    log(f"[agent] voice stuttered {gaps} times (CPU busy?)")
                return True

            ready["say"] = say
            log(f"[agent] voice {cfg.voice_local} (VieNeu-TTS, robot {cfg.voice_robot:g}) ready in {time.time() - t:.0f} s")
        except Exception as e:  # noqa: BLE001 - not installed, no model download, bad voice name: Piper keeps speaking
            log(f"[agent] no local voice ({e}): answers are read by Piper on the Pi")

    threading.Thread(target=load, daemon=True).start()
    return ready


def make_speak(cfg, play_wav, local=None):
    told = []
    local = {} if local is None else local

    def speak(text):
        if not text.strip():
            return
        log(f"[agent] VEGAS: {text}")
        if not play_wav:
            return
        if "say" in local:
            try:
                if local["say"](text):
                    return
            except Exception as e:  # noqa: BLE001
                log(f"[agent] local voice failed ({e}): Piper reads it")
        if not cfg.tts_url:
            return
        data = get_tts(cfg.tts_url, text, lang_of(text))
        if data:
            play_wav(data)
        elif not told:
            told.append(1)
            log(f"[agent] no vega-voice at {cfg.tts_url}: answers are shown, not read aloud (docker start vega-voice)")

    return speak


def mic_loop(agent, bus, cfg):
    """Opens the mic and feeds the agent. Closed for real while muted; reopened every 5 s while missing."""
    import sounddevice as sd

    muted = threading.Event()
    if cfg.hotkey:
        try:
            import keyboard

            def toggle():
                if muted.is_set():
                    muted.clear()
                    log("[agent] microphone on")
                else:
                    muted.set()
                    log("[agent] microphone OFF (closed)")

            keyboard.add_hotkey(cfg.hotkey, toggle)
            log(f"[agent] {cfg.hotkey} turns the microphone off and on")
        except Exception as e:  # noqa: BLE001
            log(f"[agent] no hotkey ({e}): pip install keyboard")
    while True:
        if muted.is_set():
            bus.publish_core("idle", "off")
            while muted.is_set():
                time.sleep(0.2)
        q = queue.Queue()
        try:
            with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=FRAME, callback=lambda d, *_: q.put(d[:, 0].copy())):
                bus.publish_core("idle", "on")
                log("[agent] listening for the wake word")
                while not muted.is_set():
                    try:
                        agent.feed(q.get(timeout=2))
                    except queue.Empty:
                        raise sd.PortAudioError("no audio for 2 s") from None
        except sd.PortAudioError as e:
            bus.publish_core("idle", "missing")
            log(f"[agent] microphone missing ({e}): trying again in 5 s")
            time.sleep(5)


def wav_frames(path):
    with wave.open(path) as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (RATE, 1, 2):
            sys.exit(f"{path}: need 16 kHz mono 16-bit")
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    for i in range(0, len(a) - FRAME + 1, FRAME):
        yield a[i : i + FRAME]


def main():
    if sys.stdout is None:  # pythonw (the sign-in task): no console, so the log goes to a file
        sys.stdout = sys.stderr = open(os.path.join(HERE, "agent.log"), "a", encoding="utf-8", buffering=1)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--wav", help="16 kHz mono WAV instead of the microphone; stops after one answer")
    args = ap.parse_args()
    load_env_file(os.path.join(HERE, ".env"), os.environ)
    cfg = Config.from_env()
    wake, wake_reset = wake_model(cfg.wake_model)
    from openwakeword.vad import VAD

    vad_model = VAD()
    bus = Bus(cfg)
    beep, play_wav = (lambda _k: None, None) if args.wav else player()
    agent = Agent(
        cfg,
        wake=wake,
        wake_reset=wake_reset,
        vad=lambda f: float(vad_model.predict(f)),
        stt=lambda wav: post_stt(cfg.stt_url, wav),
        ask=bus.ask,
        speak=make_speak(cfg, play_wav, None if args.wav else local_voice(cfg)),
        beep=beep,
        state=lambda s: bus.publish_core(s),
        log=log,
        run=(lambda fn: fn()) if args.wav else None,
    )
    if args.wav:
        if not bus.connected.wait(10):
            sys.exit(f"cannot reach MQTT at {cfg.mqtt_url}")
        silence = np.zeros(FRAME, dtype=np.int16)
        for f in wav_frames(args.wav):
            agent.feed(f)
        for _ in range(50):  # 4 s of quiet so a command at the end of the file finishes
            agent.feed(silence)
        sys.exit(0 if agent.answered else 1)
    mic_loop(agent, bus, cfg)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
