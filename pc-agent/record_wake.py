"""Record your own "Hey Vegas" clips (and other speech) for wake-word training.  Ctrl+C stops early.
    .venv\\Scripts\\python record_wake.py
Each pause-separated utterance is cut out and saved to voice_clips/positive/ then voice_clips/negative/ (16 kHz mono WAV).
"""
import os
import queue
import wave

import numpy as np
import sounddevice as sd

HERE = os.path.dirname(os.path.abspath(__file__))
RATE, FRAME = 16000, 1280  # 80 ms, as the agent reads the mic
LOUD, QUIET_FRAMES, PRE = 600, 6, 3  # start level, frames of quiet that end a clip, frames kept before the start

STEPS = [
    ("positive", 60, [
        (0, 'Nói "Hey Vegas" bình thường, ngồi trước laptop, nghỉ ~1 giây giữa các lần'),
        (15, "Bây giờ nói NHANH hơn"),
        (25, "Bây giờ nói CHẬM, kéo dài"),
        (35, "Bây giờ ngồi XA laptop 1-2 m (hoặc quay mặt đi)"),
        (45, "Bây giờ nói NHỎ giọng"),
        (52, "Bây giờ nói TO, như gọi người ở phòng bên"),
    ]),
    ("negative", 30, [
        (0, 'Bây giờ nói những câu KHÁC, KHÔNG phải "Hey Vegas": "hey", "Vegas" (riêng lẻ), "hey Google", "Las Vegas", nói chuyện bình thường... (KHÔNG nói "hây ve ga": đó chính là câu gọi)'),
    ]),
]


def save(path, a):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(a.tobytes())


def main():
    q = queue.Queue()
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=FRAME, callback=lambda d, *_: q.put(d[:, 0].copy())):
        print(f"mic: {sd.query_devices(kind='input')['name']}")
        for kind, target, hints in STEPS:
            out = os.path.join(HERE, "voice_clips", kind)
            os.makedirs(out, exist_ok=True)
            n = len([f for f in os.listdir(out) if f.endswith(".wav")])
            hint = dict(hints)
            print(f"\n=== {kind}: {n}/{target} ===")
            pre, clip, quiet = [], None, 0
            while n < target:
                if n in hint:
                    print(f"\n>> {hint.pop(n)}")
                f = q.get()
                peak = int(np.abs(f.astype(np.int32)).max())
                if clip is None:
                    pre = (pre + [f])[-PRE:]
                    if peak > LOUD:
                        clip, quiet = list(pre), 0
                    continue
                clip.append(f)
                quiet = quiet + 1 if peak < LOUD / 2 else 0
                if quiet < QUIET_FRAMES:
                    continue
                a = np.concatenate(clip[: len(clip) - QUIET_FRAMES + 3])  # keep ~0.24 s after the last loud frame
                clip = None
                secs = len(a) / RATE
                if not 0.4 <= secs <= 2.5:
                    print(f"  bỏ qua ({secs:.1f} s, quá {'ngắn' if secs < 0.4 else 'dài'})")
                    continue
                n += 1
                save(os.path.join(out, f"{n:03d}.wav"), a)
                print(f"  {kind} {n}/{target}  ({secs:.1f} s, mức {int(np.abs(a.astype(np.int32)).max())})")
    print("\nXong. Các file nằm trong voice_clips\\")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nDừng. Các clip đã thu vẫn được giữ lại; chạy lại để thu tiếp.")
