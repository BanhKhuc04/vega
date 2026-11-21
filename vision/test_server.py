"""python -m unittest discover vision  (no camera, no OpenCV: a fake source makes the frames, a fake detector the boxes)."""

import json
import os
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen

from server import Camera, Live, make_handler, split_jpegs


def jpeg(n):
    return b"\xff\xd8" + bytes([n % 256]) * 10 + b"\xff\xd9"


class FakeCamera:
    """A source that counts how often it is opened and can be unplugged."""

    def __init__(self):
        self.plugged, self.opened, self.open_now = True, 0, 0

    def present(self):
        return self.plugged

    def source(self):
        self.opened += 1
        self.open_now += 1
        try:
            n = 0
            while self.plugged:
                n += 1
                yield jpeg(n)
                time.sleep(0.01)
        finally:
            self.open_now -= 1


def until(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


class SplitTest(unittest.TestCase):
    def test_frames_across_chunks_with_uvc_padding(self):
        a, b = jpeg(1), jpeg(2)
        stream = a + b"\xed" * 320 + b + b"\xed" * 320 + jpeg(3)
        chunks = [stream[i : i + 7] for i in range(0, len(stream), 7)]
        self.assertEqual(list(split_jpegs(chunks)), [a, b])  # the last frame waits for the next one to start

    def test_garbage_only(self):
        self.assertEqual(list(split_jpegs([b"no jpeg here", b"\xff\xd9"])), [])


class CameraTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeCamera()
        self.cam = Camera(self.fake.source, self.fake.present, idle_s=0.2)

    def test_opens_on_first_use_closes_after_idle(self):
        self.assertEqual(self.fake.opened, 0)  # nobody watches: the camera stays closed
        with self.cam.use():
            self.assertIsNotNone(self.cam.next_frame(0, 2))
            with self.cam.use():  # a second viewer shares the same source
                pass
            self.assertEqual(self.fake.opened, 1)
        self.assertTrue(until(lambda: self.cam.status == "off" and self.fake.open_now == 0))

    def test_snapshot_skips_dark_frames_and_reuses_a_running_stream(self):
        frame = self.cam.snapshot()
        self.assertEqual(frame, jpeg(Camera.WARMUP))
        with self.cam.use():
            self.cam.next_frame(0, 2)
            self.cam.snapshot()
            self.assertEqual(self.fake.opened, 1)

    def test_unplugged_then_plugged_back(self):
        with self.cam.use():
            self.assertTrue(until(lambda: self.cam.status == "on"))
            self.fake.plugged = False
            self.assertTrue(until(lambda: self.cam.status == "unplugged"))
            with self.assertRaises(TimeoutError):
                self.cam.snapshot(timeout=0.3)
            self.fake.plugged = True
            self.assertTrue(until(lambda: self.cam.status == "on"))
        self.assertEqual(self.fake.opened, 2)


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeCamera()
        self.cam = Camera(self.fake.source, self.fake.present, idle_s=0.2)
        objects = [{"label": "Cốc", "box": [0.1, 0.2, 0.3, 0.4], "conf": 0.9}]
        self.live = Live(self.cam, lambda _jpeg: objects, hz=20, temp=lambda: 50)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.cam, self.live, fps=50, max_s=0.6))
        self.srv.daemon_threads = True
        self.base = f"http://127.0.0.1:{self.srv.server_port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.files = sorted(os.listdir("."))

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.assertEqual(sorted(os.listdir(".")), self.files)  # nothing written to disk

    def test_live_stream_is_mjpeg_and_ends_after_the_session_cap(self):
        with urlopen(self.base + "/vision/live", timeout=5) as r:
            self.assertEqual(r.headers["Content-Type"], "multipart/x-mixed-replace; boundary=frame")
            body = r.read()  # returns once max_s is over
        self.assertGreater(body.count(b"--frame\r\nContent-Type: image/jpeg"), 3)
        self.assertTrue(until(lambda: self.cam.status == "off"))

    def test_objects_stream_then_timeout(self):
        with urlopen(self.base + "/vision/live", timeout=5) as stream, urlopen(self.base + "/vision/live/objects", timeout=5) as r:
            self.assertEqual(r.headers["Content-Type"], "text/event-stream")
            events = [json.loads(line[6:]) for line in r.read().decode().splitlines() if line.startswith("data: ")]
            stream.read()
        live = [e for e in events if e["status"] == "live"]
        self.assertTrue(live)
        self.assertEqual(live[-1]["objects"][0]["label"], "Cốc")
        self.assertEqual(events[-1]["status"], "timeout")

    def test_snapshot_and_health(self):
        with urlopen(self.base + "/snapshot", timeout=5) as r:
            self.assertEqual(r.headers["Content-Type"], "image/jpeg")
            self.assertEqual(r.read()[:2], b"\xff\xd8")
        with urlopen(self.base + "/health", timeout=5) as r:
            self.assertEqual(json.load(r)["ok"], True)

    def test_snapshot_without_camera_is_503(self):
        self.fake.plugged = False
        self.cam.WARMUP = 10**9  # never ready
        with self.assertRaises(HTTPError) as e:
            urlopen(self.base + "/snapshot", timeout=15)
        self.assertEqual(e.exception.code, 503)

    def test_unknown_path(self):
        with self.assertRaises(HTTPError) as e:
            urlopen(self.base + "/../etc/passwd", timeout=5)
        self.assertEqual(e.exception.code, 404)


try:
    import numpy as np

    from detector import LABELS, _grids, decode
except ImportError:  # CI installs numpy and OpenCV; a bare Python skips these
    np = None


@unittest.skipIf(np is None, "numpy/OpenCV not installed")
class DetectorTest(unittest.TestCase):
    def test_decode_one_cup_in_a_raw_yolox_output(self):
        grids, strides = _grids(416)
        out = np.full((len(grids), 85), -20.0, np.float32)
        out[:, 4] = 0
        out[:, 5:] = 0
        i = 10 * 52 + 20  # stride 8 cell (20, 10): centre (164, 84) in the 416 input
        out[i, :4] = [0.5, 0.5, np.log(10), np.log(5)]  # 80 x 40 px
        out[i, 4] = 0.9
        out[i, 5 + 41] = 0.95  # class 41: cup
        objs = decode(out, grids, strides, r=416 / 640, w=640, h=360, conf=0.4, max_objects=20)
        self.assertEqual(len(objs), 1)
        self.assertEqual(objs[0]["label"], "Cốc")
        x, y, w, h = objs[0]["box"]
        self.assertAlmostEqual(x * 640, (164 - 40) * 640 / 416, delta=1)
        self.assertAlmostEqual(w * 640, 80 * 640 / 416, delta=1)
        self.assertTrue(all(0 <= v <= 1 for v in objs[0]["box"]))

    def test_every_class_has_a_vietnamese_label(self):
        self.assertEqual(len(LABELS), 80)
        self.assertTrue(all(vi.strip() for _, vi in LABELS))


if __name__ == "__main__":
    unittest.main()
