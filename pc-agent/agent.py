"""The listening loop of pc-agent (brief 0009), free of hardware so it can be tested with fake audio.

Frames of 80 ms (1280 samples, 16 kHz, int16) go in through Agent.feed(). Nothing leaves the machine until the wake word
is heard: then the command is recorded until 0.7 s of silence, transcribed by the brain (/voice/stt), sent as a command
over MQTT, and the answer is read aloud. For FOLLOW_UP_S after an answer the next sentence needs no wake word.
"""

import io
import json
import os
import re
import threading
import wave
from collections import deque
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np

RATE = 16000
FRAME = 1280  # 80 ms
FRAME_S = FRAME / RATE


@dataclass
class Config:
    """Everything pc-agent needs. On purpose no API key: speech to text goes through the brain, which holds it."""

    mqtt_url: str = "mqtt://127.0.0.1:1883"
    mqtt_user: str = ""
    mqtt_pass: str = ""
    stt_url: str = "http://127.0.0.1:8091/voice/stt"
    tts_url: str = "http://127.0.0.1:5002/voice/tts"
    voice_local: str = ""  # a VieNeu-TTS preset voice on this PC ("Hải Đăng"); empty = Piper on the Pi only
    voice_robot: float = 0.6  # 0 = plain voice .. 1 = strong robot
    wake_model: str = "hey_jarvis"
    wake_threshold: float = 0.5
    vad_threshold: float = 0.5
    follow_up_s: float = 6.0
    hotkey: str = "ctrl+alt+m"
    end_silence_s: float = 0.7
    no_speech_s: float = 3.0
    # noise must not become a command: a follow-up needs this much uninterrupted speech, a command this much in all
    follow_start_s: float = 0.24
    min_speech_s: float = 0.4
    max_command_s: float = 10.0

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        c = cls()
        num = lambda k, d: float(env[k]) if env.get(k, "").strip() else d  # noqa: E731
        return cls(
            mqtt_url=env.get("MQTT_URL") or c.mqtt_url,
            mqtt_user=env.get("MQTT_USER", ""),
            mqtt_pass=env.get("MQTT_PASS", ""),
            stt_url=env.get("VEGA_STT_URL") or c.stt_url,
            tts_url=env["VEGA_TTS_URL"] if "VEGA_TTS_URL" in env else c.tts_url,  # empty = do not read aloud
            voice_local=env.get("VOICE_LOCAL", "").strip(),
            voice_robot=num("VOICE_ROBOT", c.voice_robot),
            wake_model=env.get("WAKE_MODEL") or c.wake_model,
            wake_threshold=num("WAKE_THRESHOLD", c.wake_threshold),
            follow_up_s=num("FOLLOW_UP_S", c.follow_up_s),
            hotkey=env.get("HOTKEY", c.hotkey),
        )


def load_env_file(path, env):
    """KEY=value lines into `env` (never overriding what is already set). No dependency for a dozen lines."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())


def to_wav(frames):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(f.tobytes() for f in frames))
    return buf.getvalue()


class SttError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


# what VEGA says when hearing failed (read aloud if possible, always logged): never silent
PROBLEM = {
    "off": "Chưa bật nhận dạng giọng nói: bộ não chưa có STT_API_KEY.",
    "budget": "Hết ngân sách AI hôm nay, mai mình nghe tiếp nhé.",
    "minutes": "Hết phút nghe giọng nói của hôm nay.",
    "offline": "Mất mạng, chưa nghe được.",
    "provider": "Dịch vụ nhận dạng không trả lời, thử lại sau nhé.",
    "unreachable": "Không nối được tới bộ não.",
    "no_answer": "Bộ não không trả lời.",
}


def post_stt(url, wav, timeout=30):
    """POST the WAV to the brain; the words, or SttError with the brain's code."""
    req = Request(url, data=wav, method="POST", headers={"content-type": "audio/wav"})
    try:
        with urlopen(req, timeout=timeout) as r:
            return str(json.loads(r.read()).get("text", "")).strip()
    except HTTPError as e:
        with e:
            try:
                code = json.loads(e.read()).get("error")
            except ValueError:
                code = None
        raise SttError(code if code in PROBLEM else "provider") from None
    except (URLError, OSError):
        raise SttError("unreachable") from None


def get_tts(url, text, lang, timeout=30):
    """WAV bytes from vega-voice, or None when it is not there."""
    try:
        with urlopen(f"{url}?{urlencode({'text': text[:500], 'lang': lang})}", timeout=timeout) as r:
            return r.read() if r.headers.get("content-type", "").startswith("audio/") else None
    except (URLError, OSError):
        return None


class Robot:
    """Robot colour, chunk by chunk (streamed audio): metallic comb echoes, a low ring-modulation buzz ("rè rè") and a
    little saturation for grit. amount 0 = the plain voice, 1 = strong."""

    TAPS = ((0.007, 0.35), (0.013, 0.25), (0.045, 0.12))  # (delay s, gain): short = metallic, 45 ms = room, never an echo
    BUZZ_HZ = 70

    def __init__(self, rate, amount=0.6):
        self.rate, self.a = rate, min(1.0, max(0.0, float(amount)))
        self.taps = [(int(rate * s), g * self.a) for s, g in self.TAPS]
        self.hist = np.zeros(max(d for d, _ in self.taps), np.float32)
        self.done = 0  # samples so far: the buzz keeps its phase across chunks

    def __call__(self, x):
        x = x.astype(np.float32)
        if not self.a:
            return x
        buf = np.concatenate([self.hist, x])
        n, y = len(self.hist), x.copy()
        for d, g in self.taps:
            y += g * buf[n - d : len(buf) - d]
        self.hist = buf[-n:]
        t = (self.done + np.arange(len(x))) / self.rate
        self.done += len(x)
        m = 0.5 * self.a
        y *= (1 - m) + m * np.sin(2 * np.pi * self.BUZZ_HZ * t)
        drive = 1 + 1.5 * self.a
        y /= 1 + sum(g for _, g in self.taps)  # a fixed level: a streamed peak is not known in advance
        return (np.tanh(drive * y) / np.tanh(drive)).astype(np.float32)


VI = set("àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ")


# ends the conversation: back to needing the wake word right after the answer
BYE = re.compile(r"\b(tạm biệt|bye|goodbye|good night|chúc ngủ ngon|thôi nhé|dừng lại|stop listening)\b", re.I)


def lang_of(text):
    return "vi" if any(c in VI for c in text.lower()) else "en"


class Agent:
    """
    idle      waiting for the wake word (nothing is sent anywhere)
    listening recording a command until silence
    follow    after an answer: a sentence without the wake word starts a command
    busy      transcribing, asking, speaking: the mic is not listened to (VEGA must not hear itself)
    """

    def __init__(self, cfg, *, wake, wake_reset, vad, stt, ask, speak, beep, state, log=print, run=None):
        self.cfg = cfg
        self.wake, self.wake_reset, self.vad = wake, wake_reset, vad
        self.stt, self.ask, self.speak, self.beep, self.publish = stt, ask, speak, beep, state
        self.log = log
        self.run = run or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.mode = "idle"
        self.pre = deque(maxlen=4)  # 320 ms before speech starts in the follow window, so the first word is not cut
        self.frames = []
        self.heard = False
        self.silent = 0
        self.count = 0
        self.speech = 0  # speech frames in the command being recorded
        self.run_len = 0  # uninterrupted speech frames in the follow window
        self.answered = 0

    def frames_for(self, seconds):
        return max(1, round(seconds / FRAME_S))

    def feed(self, frame):
        if self.mode == "busy":
            return
        if self.mode == "idle":
            score = self.wake(frame)
            if score >= self.cfg.wake_threshold:
                self.log(f"[agent] wake word ({score:.2f})")
                self.wake_reset()  # its score stays high for a while: do not trigger twice
                self.beep("wake")
                self.start(heard=False)
            return
        speech = self.vad(frame) >= self.cfg.vad_threshold
        self.count += 1
        if self.mode == "follow":
            self.pre.append(frame)
            self.run_len = self.run_len + 1 if speech else 0
            if self.run_len >= self.frames_for(self.cfg.follow_start_s):
                self.log("[agent] follow-up speech")
                self.frames, ran = list(self.pre), self.run_len
                self.start(heard=True, keep=True)  # resets run_len
                self.speech = ran
            elif self.count >= self.frames_for(self.cfg.follow_up_s):
                self.to_idle()
            return
        self.frames.append(frame)
        if speech:
            self.heard, self.silent = True, 0
            self.speech += 1
        elif self.heard:
            self.silent += 1
        if self.heard and self.silent >= self.frames_for(self.cfg.end_silence_s) or self.count >= self.frames_for(self.cfg.max_command_s):
            self.finish()
        elif not self.heard and self.count >= self.frames_for(self.cfg.no_speech_s):
            self.log("[agent] wake word but no speech: nothing sent")
            self.to_idle()

    def start(self, heard, keep=False):
        if not keep:
            self.frames = []
        self.mode, self.heard, self.silent, self.count, self.speech, self.run_len = "listening", heard, 0, 0, 0, 0
        self.publish("listening")

    def to_idle(self):
        self.mode, self.frames, self.run_len = "idle", [], 0
        self.pre.clear()
        self.publish("idle")

    def finish(self):
        if self.speech < self.frames_for(self.cfg.min_speech_s):
            self.log(f"[agent] only {self.speech * FRAME_S:.2f} s of speech (noise?): nothing sent")
            return self.to_idle()
        frames, self.frames = self.frames, []
        self.mode = "busy"
        self.publish("thinking")
        self.run(lambda: self.handle(frames))

    def handle(self, frames):
        answered = False
        try:
            self.log(f"[agent] sending {len(frames) * FRAME_S:.1f} s of audio to speech to text")
            text = self.stt(to_wav(frames))
            if not text:
                self.log("[agent] heard nothing")
                return
            self.log(f"[agent] heard: {text}")
            r = self.ask(text)
            if r is None:
                return self.say_problem("no_answer")
            self.publish("speaking")
            self.speak(r.get("speak") or r.get("result") or "")
            answered = not BYE.search(text)
            self.answered += 1
        except SttError as e:
            self.say_problem(e.code)
        except Exception as e:  # noqa: BLE001 - the loop must survive anything a request throws
            self.log(f"[agent] failed: {e}")
            self.beep("error")
        finally:
            self.wake_reset()
            if answered:
                self.mode, self.count, self.run_len = "follow", 0, 0
                self.pre.clear()
                self.publish("idle")
            else:
                self.to_idle()

    def say_problem(self, code):
        msg = PROBLEM.get(code, PROBLEM["provider"])
        self.log(f"[agent] {code}: {msg}")
        self.beep("error")
        self.speak(msg)
