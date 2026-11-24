"""python -m unittest discover pc-agent  — no microphone, no model: frames carry a marker the fake wake/VAD read."""

import io
import json
import re
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

from agent import FRAME, PROBLEM, Agent, Config, Robot, SttError, get_tts, lang_of, load_env_file, post_stt, to_wav

QUIET, WAKE, SPEECH = 0, 1, 2


def frames(kind, seconds):
    return [np.full(FRAME, kind, dtype=np.int16) for _ in range(round(seconds / 0.08))]


class Rig:
    """An Agent wired to recorders; ask/stt answers can be swapped per test."""

    def __init__(self, **kw):
        self.events, self.states, self.sent, self.asked, self.spoken, self.beeps, self.resets = [], [], [], [], [], [], 0
        self.text = kw.pop("text", "phòng mấy độ")
        self.answer = kw.pop("answer", {"result": "Bedroom 25.0°C"})
        self.stt_error = kw.pop("stt_error", None)

        def stt(wav):
            self.sent.append(wav)
            if self.stt_error:
                raise SttError(self.stt_error)
            return self.text

        def reset():
            self.resets += 1

        self.agent = Agent(
            Config(**kw),
            wake=lambda f: 1.0 if f[0] == WAKE else 0.0,
            wake_reset=reset,
            vad=lambda f: 1.0 if f[0] == SPEECH else 0.0,
            stt=stt,
            ask=lambda t: (self.asked.append(t), self.answer)[1],
            speak=self.spoken.append,
            beep=self.beeps.append,
            state=self.states.append,
            log=lambda m: None,
            run=lambda fn: fn(),
        )

    def feed(self, *chunks):
        for chunk in chunks:
            for f in chunk:
                self.agent.feed(f)


class AgentTest(unittest.TestCase):
    def test_wake_record_until_silence_send_ask_speak(self):
        r = Rig()
        r.feed(frames(QUIET, 1), frames(WAKE, 0.08), frames(QUIET, 0.3), frames(SPEECH, 1.2), frames(QUIET, 0.8))
        self.assertEqual(r.beeps, ["wake"])
        self.assertEqual(len(r.sent), 1)
        with wave.open(io.BytesIO(r.sent[0])) as w:
            self.assertEqual((w.getframerate(), w.getnchannels()), (16000, 1))
            self.assertAlmostEqual(w.getnframes() / 16000, 0.3 + 1.2 + 0.72, delta=0.1)  # wake word itself is not sent
        self.assertEqual(r.asked, ["phòng mấy độ"])
        self.assertEqual(r.spoken, ["Bedroom 25.0°C"])
        self.assertEqual(r.states, ["listening", "thinking", "speaking", "idle"])
        self.assertEqual(r.agent.mode, "follow")

    def test_nothing_leaves_without_the_wake_word(self):
        r = Rig()
        r.feed(frames(SPEECH, 5), frames(QUIET, 2))
        self.assertEqual((r.sent, r.states), ([], []))

    def test_wake_word_but_no_speech_sends_nothing(self):
        r = Rig()
        r.feed(frames(WAKE, 0.2), frames(QUIET, 3.5))
        self.assertEqual(r.sent, [])
        self.assertEqual(r.states, ["listening", "idle"])

    def test_long_command_is_cut_at_10_seconds(self):
        r = Rig()
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 12))
        with wave.open(io.BytesIO(r.sent[0])) as w:
            self.assertLessEqual(w.getnframes() / 16000, 10.1)

    def test_follow_up_without_wake_word_then_back_to_idle(self):
        r = Rig()
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        r.text = "bật đèn phòng khách"
        r.feed(frames(QUIET, 2), frames(SPEECH, 1), frames(QUIET, 0.8))
        self.assertEqual(r.asked, ["phòng mấy độ", "bật đèn phòng khách"])
        with wave.open(io.BytesIO(r.sent[1])) as w:
            self.assertGreater(w.getnframes() / 16000, 1.0 + 0.2)  # the frames just before the speech are kept
        r.feed(frames(QUIET, 6.5))
        self.assertEqual(r.agent.mode, "idle")
        r.feed(frames(SPEECH, 2), frames(QUIET, 1))
        self.assertEqual(len(r.sent), 2)  # back to needing the wake word

    def test_noise_in_the_follow_window_is_not_a_command(self):
        r = Rig()
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        blips = [f for _ in range(10) for f in frames(SPEECH, 0.16) + frames(QUIET, 0.24)]  # a door, a cough, a TV
        r.feed(blips)
        self.assertEqual(len(r.sent), 1)

    def test_too_little_speech_after_the_wake_word_is_not_sent(self):
        r = Rig()
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 0.24), frames(QUIET, 1))
        self.assertEqual(r.sent, [])
        self.assertEqual(r.agent.mode, "idle")

    def test_follow_up_counts_the_speech_that_started_it(self):
        r = Rig()
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        r.feed(frames(SPEECH, 0.48), frames(QUIET, 0.8))  # 0.48 s >= min_speech_s 0.4: a command, not noise
        self.assertEqual(len(r.sent), 2)

    def test_goodbye_ends_the_conversation(self):
        r = Rig(text="Tạm biệt.", answer={"result": "Tạm biệt nhé!"})
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        self.assertEqual(r.spoken, ["Tạm biệt nhé!"])
        self.assertEqual(r.agent.mode, "idle")
        r.feed(frames(SPEECH, 1), frames(QUIET, 1))
        self.assertEqual(len(r.sent), 1)  # the wake word is needed again

    def test_follow_up_window_is_configurable(self):
        r = Rig(follow_up_s=1)
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8), frames(QUIET, 1.2))
        self.assertEqual(r.agent.mode, "idle")

    def test_not_listening_while_busy(self):
        r = Rig()
        r.agent.mode = "busy"
        r.feed(frames(WAKE, 1), frames(SPEECH, 2), frames(QUIET, 1))
        self.assertEqual((r.sent, r.states), ([], []))

    def test_wake_score_reset_after_trigger_and_after_answer(self):
        r = Rig()
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        self.assertEqual(r.resets, 2)

    def test_problems_are_said_aloud_never_silent(self):
        for code in ["off", "budget", "minutes", "offline", "provider", "unreachable"]:
            r = Rig(stt_error=code)
            r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
            self.assertEqual(r.spoken, [PROBLEM[code]], code)
            self.assertEqual(r.beeps, ["wake", "error"])
            self.assertEqual(r.agent.mode, "idle")
        r = Rig(answer=None)
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        self.assertEqual(r.spoken, [PROBLEM["no_answer"]])

    def test_empty_transcript_goes_back_to_idle(self):
        r = Rig(text="")
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        self.assertEqual((r.asked, r.spoken, r.agent.mode), ([], [], "idle"))

    def test_speak_reads_the_short_version(self):
        r = Rig(answer={"result": "Long answer [1]", "speak": "Short"})
        r.feed(frames(WAKE, 0.1), frames(SPEECH, 1), frames(QUIET, 0.8))
        self.assertEqual(r.spoken, ["Short"])


class ConfigTest(unittest.TestCase):
    def test_no_key_anywhere(self):
        # speech to text goes through the brain: the agent never holds an API key
        self.assertFalse([f for f in Config.__dataclass_fields__ if re.search(r"api|secret|token|(^|_)key$", f)])
        c = Config.from_env({"STT_API_KEY": "gsk_secret", "WAKE_THRESHOLD": "0.7", "VEGA_TTS_URL": ""})
        self.assertNotIn("gsk_secret", repr(c))
        self.assertEqual((c.wake_threshold, c.tts_url), (0.7, ""))

    def test_env_file_never_overrides(self):
        import os
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False, encoding="utf-8") as f:
            f.write("# comment\nWAKE_MODEL=models/hey_vega.onnx\nFOLLOW_UP_S=4\n")
        env = {"FOLLOW_UP_S": "8"}
        load_env_file(f.name, env)
        os.unlink(f.name)
        self.assertEqual(env, {"FOLLOW_UP_S": "8", "WAKE_MODEL": "models/hey_vega.onnx"})

    def test_robot_streamed_equals_whole(self):
        x = np.random.default_rng(1).uniform(-0.5, 0.5, 48000).astype(np.float32)
        whole = Robot(48000)(x)
        r = Robot(48000)
        parts = np.concatenate([r(c) for c in np.split(x, [100, 2000, 2100, 30000])])  # chunks shorter than the delays too
        np.testing.assert_allclose(parts, whole, atol=1e-6)
        self.assertLessEqual(np.abs(whole).max(), 1.0)

    def test_local_voice_env(self):
        c = Config.from_env({"VOICE_LOCAL": " Hải Đăng ", "VOICE_ROBOT": "0.3"})
        self.assertEqual((c.voice_local, c.voice_robot), ("Hải Đăng", 0.3))
        self.assertEqual((Config.from_env({}).voice_local, Config.from_env({}).voice_robot), ("", 0.6))

    def test_robot_zero_is_the_plain_voice(self):
        x = np.linspace(-0.5, 0.5, 1000, dtype=np.float32)
        np.testing.assert_array_equal(Robot(48000, 0)(x), x)

    def test_lang(self):
        self.assertEqual((lang_of("Phòng ngủ 25 độ"), lang_of("Bedroom 25.0°C")), ("vi", "en"))

    def test_wav(self):
        with wave.open(io.BytesIO(to_wav(frames(QUIET, 0.16)))) as w:
            self.assertEqual(w.getnframes(), 2 * FRAME)


class HttpTest(unittest.TestCase):
    """post_stt / get_tts against a tiny stand-in of the brain and vega-voice."""

    reply = (200, "application/json", b'{"text": " ph\\u00f2ng m\\u1ea5y \\u0111\\u1ed9 "}')

    @classmethod
    def setUpClass(cls):
        test = cls

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["content-length"]))
                self.respond()

            def do_GET(self):
                self.respond()

            def respond(self):
                status, ctype, body = test.reply
                self.send_response(status)
                self.send_header("content-type", ctype)
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        cls.url = f"http://127.0.0.1:{cls.srv.server_port}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def set(self, status, ctype, body):
        type(self).reply = (status, ctype, body)

    def test_stt_text_and_errors(self):
        self.set(200, "application/json", json.dumps({"text": " phòng mấy độ "}).encode())
        self.assertEqual(post_stt(self.url, b"RIFF"), "phòng mấy độ")
        for status, body, code in [(429, b'{"error":"budget"}', "budget"), (503, b'{"error":"off"}', "off"), (502, b"Bad Gateway", "provider")]:
            self.set(status, "application/json", body)
            with self.assertRaises(SttError) as e:
                post_stt(self.url, b"RIFF")
            self.assertEqual(e.exception.code, code)
        with self.assertRaises(SttError) as e:
            post_stt("http://127.0.0.1:1/voice/stt", b"RIFF", timeout=2)
        self.assertEqual(e.exception.code, "unreachable")

    def test_tts_audio_or_none(self):
        self.set(200, "audio/wav", b"RIFF0000")
        self.assertEqual(get_tts(self.url, "Xin chào", "vi"), b"RIFF0000")
        self.set(200, "text/html", b"<html>")
        self.assertIsNone(get_tts(self.url, "Xin chào", "vi"))
        self.assertIsNone(get_tts("http://127.0.0.1:1/voice/tts", "hi", "en", timeout=2))


if __name__ == "__main__":
    unittest.main()
