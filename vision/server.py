"""vega-vision: the only process that opens the camera; live video and on-Pi YOLO for the Vision screen (M7.1, brief 0011).

GET /vision/live          ->  multipart/x-mixed-replace MJPEG, the camera's own JPEG frames (not re-encoded), <= LIVE_FPS
GET /vision/live/objects  ->  text/event-stream: {"status", "fps", "objects": [{"label", "box": [x, y, w, h], "conf"}]}
GET /snapshot             ->  image/jpeg, one fresh frame (the brain's "trên bàn có gì?"; compose network only)
GET /health               ->  {"ok": true, "camera": "off"|"on"|"unplugged", "viewers": n}

The camera runs only while someone watches or a snapshot is taken (L5): it closes IDLE_S after the last viewer leaves, a viewing
session ends after LIVE_MAX_MIN. Frames live in memory only; nothing is written to disk, logs hold times and counts.
"""

import json
import os
import subprocess
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SOI, EOI = b"\xff\xd8", b"\xff\xd9"
TEMP_FILE = "/sys/class/thermal/thermal_zone0/temp"


def env_num(name, default, lo):
    try:
        return max(float(os.environ.get(name, default)), lo)
    except ValueError:
        return default


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} [vision] {msg}", flush=True)


def split_jpegs(chunks):
    """Whole JPEG frames from an MJPEG byte stream. A frame ends at its last FFD9 before the next FFD8 (UVC pads frames)."""
    buf = b""
    for chunk in chunks:
        buf += chunk
        while True:
            s = buf.find(SOI)
            n = buf.find(SOI, s + 2) if s >= 0 else -1
            if n < 0:
                buf = buf[s:] if s >= 0 else b""
                break
            e = buf.rfind(EOI, s, n)
            if e > s:
                yield buf[s : e + 2]
            buf = buf[n:]


def v4l2_source(device, size):
    """Frames from the camera until it fails (unplugged) or the generator is closed."""
    w, h = size.split("x")
    args = ["v4l2-ctl", "-d", device, f"--set-fmt-video=width={w},height={h},pixelformat=MJPG", "--stream-mmap", "--stream-count=0", "--stream-to=-"]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        yield from split_jpegs(iter(lambda: proc.stdout.read1(1 << 16), b""))
    finally:
        proc.kill()
        proc.wait()


def file_source(path, fps=15):
    """CAMERA=sim: the sample photo, again and again."""
    jpeg = open(path, "rb").read()
    while True:
        yield jpeg
        time.sleep(1 / fps)


class Camera:
    """Opens the source on first use, closes it idle_s after the last user; survives being unplugged and plugged back."""

    WARMUP = 8  # the first frames are dark while the camera sets its exposure

    def __init__(self, open_source, present, idle_s=10.0):
        self.open_source, self.present, self.idle_s = open_source, present, idle_s
        self.cond = threading.Condition()
        self.frame, self.seq, self.fresh = None, 0, 0
        self.status, self.users, self.last_use, self.thread = "off", 0, 0.0, None

    @contextmanager
    def use(self):
        with self.cond:
            self.users += 1
            if self.thread is None:
                self.thread = threading.Thread(target=self._run, daemon=True)
                self.thread.start()
        try:
            yield self
        finally:
            with self.cond:
                self.users -= 1
                self.last_use = time.monotonic()

    def _idle(self):
        return self.users == 0 and time.monotonic() - self.last_use >= self.idle_s

    def _set(self, status):
        with self.cond:
            if status != self.status:
                log(f"camera {status}")
            self.status = status
            self.cond.notify_all()

    def _run(self):
        frames = 0
        while True:
            with self.cond:
                if self._idle():
                    self.status, self.frame, self.thread = "off", None, None
                    self.cond.notify_all()
                    log(f"camera off after {frames} frames")
                    return
            if not self.present():
                self._set("unplugged")
                time.sleep(1)
                continue
            src = self.open_source()
            try:
                with self.cond:
                    self.fresh = 0
                for jpeg in src:
                    frames += 1
                    if self.status != "on":
                        self._set("on")
                    with self.cond:
                        self.frame = jpeg
                        self.seq += 1
                        self.fresh += 1
                        self.cond.notify_all()
                        if self._idle():
                            break
                else:
                    self._set("unplugged" if not self.present() else "error")
                    time.sleep(1)
            except Exception as e:  # noqa: BLE001 - a failing camera must never kill the service
                log(f"camera error: {e}")
                self._set("error")
                time.sleep(1)
            finally:
                src.close()

    def next_frame(self, after, timeout):
        """(seq, jpeg) of a frame newer than `after`, or None after `timeout` seconds."""
        with self.cond:
            if self.cond.wait_for(lambda: self.seq > after and self.frame is not None, timeout):
                return self.seq, self.frame
            return None

    def snapshot(self, timeout=10.0):
        """One frame taken after the exposure settled. Raises TimeoutError when the camera gives none."""
        with self.use():
            with self.cond:
                if not self.cond.wait_for(lambda: self.fresh >= self.WARMUP and self.frame is not None, timeout):
                    raise TimeoutError(f"camera {self.status}")
                return self.frame


class Live:
    """Runs `analyze(jpeg) -> objects` on the newest frame at most `hz` times a second while the camera is on."""

    def __init__(self, camera, analyze, hz=4.0, temp=None):
        self.camera, self.analyze, self.hz, self.temp = camera, analyze, hz, temp or read_temp
        self.cond = threading.Condition()
        self.result, self.rev = {"status": "off", "fps": 0, "objects": []}, 0
        threading.Thread(target=self._run, daemon=True).start()

    def _publish(self, **result):
        with self.cond:
            self.result = {**self.result, **result}
            self.rev += 1
            self.cond.notify_all()

    def _run(self):
        seq, done, hot = 0, [], False
        while True:
            got = self.camera.next_frame(seq, timeout=1)
            status = {"on": "live", "off": "off"}.get(self.camera.status, self.camera.status)
            if status != self.result["status"]:
                self._publish(status=status, **({} if status == "live" else {"objects": [], "fps": 0}))
            if not got:
                continue
            seq, jpeg = got
            start = time.monotonic()
            try:
                objects = self.analyze(jpeg)
            except Exception as e:  # noqa: BLE001
                log(f"detector error: {e}")
                objects = []
            now = time.monotonic()
            done = [t for t in done if now - t < 2] + [now]
            self._publish(status="live", objects=objects, fps=round(len(done) / 2, 1), ts=int(time.time() * 1000))
            # L10: a hot Pi detects at half the rate
            t = self.temp()
            if (t is not None and t > 75) != hot:
                hot = not hot
                log(f"{'hot' if hot else 'cool'} ({t:.0f} C): detecting at {self.hz / 2 if hot else self.hz:g} Hz")
            time.sleep(max(0.0, (2 if hot else 1) / self.hz - (time.monotonic() - start)))

    def wait(self, after, timeout):
        with self.cond:
            self.cond.wait_for(lambda: self.rev > after, timeout)
            return self.rev, self.result


def read_temp():
    try:
        return int(open(TEMP_FILE).read()) / 1000
    except (OSError, ValueError):
        return None


def make_analyze(model_path):
    import cv2
    import numpy as np

    from detector import Detector

    det = Detector(model_path)
    # decoded at half size (1280x720 -> 640x360): the model input is 416 px anyway
    return lambda jpeg: det.detect(cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_REDUCED_COLOR_2))


def make_handler(camera, live, fps=10.0, max_s=900.0):
    class Handler(BaseHTTPRequestHandler):
        server_version = "vega-vision"

        def log_message(self, *args):  # no access log: the times of each viewer are enough (logged by Camera)
            pass

        def head(self, status, ctype, length=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            if length is not None:
                self.send_header("Content-Length", str(length))
            self.end_headers()

        def send_json(self, status, obj):
            body = json.dumps(obj).encode()
            self.head(status, "application/json", len(body))
            self.wfile.write(body)

        def do_GET(self):
            path = urlsplit(self.path).path
            try:
                if path == "/health":
                    self.send_json(200, {"ok": True, "camera": camera.status, "viewers": camera.users})
                elif path == "/snapshot":
                    self.snapshot()
                elif path == "/vision/live":
                    self.stream()
                elif path == "/vision/live/objects":
                    self.objects()
                else:
                    self.send_json(404, {"error": "not found"})
            except (BrokenPipeError, ConnectionResetError):
                pass  # the viewer left

        def snapshot(self):
            try:
                jpeg = camera.snapshot()
            except TimeoutError as e:
                return self.send_json(503, {"error": str(e)})
            self.head(200, "image/jpeg", len(jpeg))
            self.wfile.write(jpeg)

        def stream(self):
            self.head(200, "multipart/x-mixed-replace; boundary=frame")
            end, seq, sent = time.monotonic() + max_s, 0, 0.0
            with camera.use():
                while time.monotonic() < end:
                    got = camera.next_frame(seq, timeout=1)
                    if not got:
                        continue
                    seq, jpeg = got
                    if time.monotonic() - sent < 1 / fps:
                        continue
                    sent = time.monotonic()
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpeg) + jpeg + b"\r\n")

        def objects(self):
            self.head(200, "text/event-stream")
            end, rev = time.monotonic() + max_s, 0
            while time.monotonic() < end:
                new, result = live.wait(rev, timeout=min(15, max(0.0, end - time.monotonic())))
                self.wfile.write(f"data: {json.dumps(result, ensure_ascii=False)}\n\n".encode() if new != rev else b": keep-alive\n\n")
                self.wfile.flush()
                rev = new
            # L5: the session is over; the page shows "Tiếp tục xem" instead of reconnecting
            self.wfile.write(f"data: {json.dumps({'status': 'timeout', 'fps': 0, 'objects': []})}\n\n".encode())

    return Handler


def main():
    sim = os.environ.get("CAMERA") == "sim"
    device = os.environ.get("CAMERA_DEVICE", "/hostdev/video0")
    size = os.environ.get("CAMERA_SIZE", "1280x720")
    sample = os.environ.get("SAMPLE", "/app/desk.jpg")
    camera = Camera(
        (lambda: file_source(sample)) if sim else (lambda: v4l2_source(device, size)),
        (lambda: True) if sim else (lambda: os.path.exists(device)),
        idle_s=env_num("IDLE_S", 10, 1),
    )
    live = Live(camera, make_analyze(os.environ.get("MODEL", "/models/yolox_nano.onnx")), hz=env_num("DETECT_HZ", 4, 0.5))
    port = int(os.environ.get("PORT", "8092"))
    srv = ThreadingHTTPServer(("0.0.0.0", port), make_handler(camera, live, fps=env_num("LIVE_FPS", 10, 1), max_s=env_num("LIVE_MAX_MIN", 15, 1) * 60))
    srv.daemon_threads = True
    log(f"listening on :{port}, camera {'sim ' + sample if sim else device}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
