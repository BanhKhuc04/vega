"""vega-voice: reads text aloud with Piper, offline (M5, brief 0008 V3).

GET /voice/tts?text=...&lang=vi|en  ->  audio/wav
GET /health                         ->  {"ok": true}

Only reachable inside the Docker network; nginx of vega-ui forwards /voice/tts to it. Nothing leaves the Pi.
Standard library only, besides Piper itself.
"""

import io
import json
import os
import re
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

MAX_CHARS = 500
VOICES = {
    "vi": os.environ.get("VOICE_VI", "vi_VN-vais1000-medium"),
    "en": os.environ.get("VOICE_EN", "en_US-lessac-medium"),
}
VOICE_DIR = os.environ.get("VOICE_DIR", "/voices")
CLOCK = re.compile(r"(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])")


def spoken(text, lang):
    """Piper's Vietnamese voice reads "22:23" as "22 323": say the time in words ("22 giờ 23", "7 giờ")."""
    if lang != "vi":
        return text
    return CLOCK.sub(lambda m: f"{int(m[1])} giờ" + (f" {int(m[2])}" if m[2] != "00" else ""), text)


def piper_loader(lang):
    from piper import PiperVoice  # imported here so the tests run without Piper installed

    return PiperVoice.load(os.path.join(VOICE_DIR, VOICES[lang] + ".onnx"))


class Speaker:
    """Loads each voice on first use (saves RAM when one language is never spoken) and synthesizes one text at a time."""

    def __init__(self, loader=piper_loader):
        self.loader = loader
        self.voices = {}
        self.lock = threading.Lock()  # one synthesis at a time: a Pi has little CPU and RAM to spare

    def wav(self, text, lang):
        with self.lock:
            if lang not in self.voices:
                self.voices[lang] = self.loader(lang)
            buf = io.BytesIO()
            with wave.open(buf, "wb") as w:
                self.voices[lang].synthesize_wav(spoken(text, lang), w)
            return buf.getvalue()


def check(query):
    """Returns (text, lang) or raises ValueError with the reason."""
    q = parse_qs(query)
    text = (q.get("text") or [""])[0].strip()
    lang = (q.get("lang") or [""])[0]
    if lang not in VOICES:
        raise ValueError("lang must be vi or en")
    if not text:
        raise ValueError("text is empty")
    if len(text) > MAX_CHARS:
        raise ValueError(f"text longer than {MAX_CHARS} characters")
    return text, lang


def make_handler(speaker):
    class Handler(BaseHTTPRequestHandler):
        server_version = "vega-voice"

        def send(self, status, body, ctype):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def error(self, status, msg):
            self.send(status, json.dumps({"error": msg}).encode(), "application/json")

        def do_GET(self):
            url = urlsplit(self.path)
            if url.path == "/health":
                return self.send(200, b'{"ok":true}', "application/json")
            if url.path != "/voice/tts":
                return self.error(404, "not found")
            try:
                text, lang = check(url.query)
            except ValueError as e:
                return self.error(400, str(e))
            try:
                audio = speaker.wav(text, lang)
            except Exception as e:  # a missing or broken voice file: say so, keep serving
                self.log_message("synthesis failed (%s): %s", lang, e)
                return self.error(500, "synthesis failed")
            self.send(200, audio, "audio/wav")

        def log_message(self, fmt, *args):
            # the access log would carry what VEGA says (the text is in the URL): keep only errors
            if not fmt.startswith('"'):
                super().log_message(fmt, *args)

    return Handler


def main():
    port = int(os.environ.get("PORT", "5002"))
    srv = ThreadingHTTPServer(("0.0.0.0", port), make_handler(Speaker()))
    print(f"vega-voice on :{port} (voices {VOICES['vi']}, {VOICES['en']})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
