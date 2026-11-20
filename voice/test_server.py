"""python -m unittest discover voice  (no Piper needed: a fake voice writes a short silence)."""

import io
import json
import threading
import unittest
import wave
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import urlopen

from server import Speaker, make_handler


class FakeVoice:
    def __init__(self, lang):
        self.lang = lang

    def synthesize_wav(self, text, w):
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(22050)
        w.writeframes(b"\0\0" * 2205)


class TtsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.loaded = []

        def loader(lang):
            cls.loaded.append(lang)
            return FakeVoice(lang)

        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(Speaker(loader)))
        cls.base = f"http://127.0.0.1:{cls.srv.server_port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def get(self, path):
        try:
            with urlopen(self.base + path) as r:
                return r.status, r.headers["Content-Type"], r.read()
        except HTTPError as e:
            with e:
                return e.code, e.headers["Content-Type"], e.read()

    def test_vietnamese_wav(self):
        status, ctype, body = self.get("/voice/tts?text=" + quote("Xin chào") + "&lang=vi")
        self.assertEqual((status, ctype), (200, "audio/wav"))
        with wave.open(io.BytesIO(body)) as w:
            self.assertEqual(w.getframerate(), 22050)
            self.assertGreater(w.getnframes(), 0)

    def test_voice_loaded_once(self):
        self.get("/voice/tts?text=a&lang=vi")
        self.get("/voice/tts?text=b&lang=vi")
        self.assertEqual(self.loaded.count("vi"), 1)

    def test_rejects_long_text_unknown_lang_empty(self):
        for path in ["/voice/tts?text=" + "a" * 501 + "&lang=vi", "/voice/tts?text=hi&lang=fr", "/voice/tts?text=%20&lang=en", "/voice/tts?text=hi"]:
            status, ctype, body = self.get(path)
            self.assertEqual((status, ctype), (400, "application/json"), path)
            self.assertIn("error", json.loads(body))

    def test_500_chars_is_fine(self):
        self.assertEqual(self.get("/voice/tts?text=" + "a" * 500 + "&lang=en")[0], 200)

    def test_missing_voice_is_500_not_a_crash(self):
        def missing(lang):
            raise FileNotFoundError(lang)

        srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(Speaker(missing)))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            base, self.base = self.base, f"http://127.0.0.1:{srv.server_port}"
            self.assertEqual(self.get("/voice/tts?text=hi&lang=en")[0], 500)
            self.assertEqual(self.get("/health")[0], 200)
        finally:
            self.base = base
            srv.shutdown()

    def test_unknown_path(self):
        self.assertEqual(self.get("/voice/other")[0], 404)


if __name__ == "__main__":
    unittest.main()
