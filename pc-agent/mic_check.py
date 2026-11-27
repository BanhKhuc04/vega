"""Live mic level and wake-word scores, to check the agent can hear you.  Ctrl+C to stop.
    .venv\\Scripts\\python mic_check.py [model.onnx ...]      (default: every models/*.onnx)
"""
import glob
import os
import sys

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

HERE = os.path.dirname(os.path.abspath(__file__))
paths = [os.path.join(HERE, p) for p in sys.argv[1:]] or sorted(glob.glob(os.path.join(HERE, "models", "*.onnx")))
m = Model(wakeword_models=paths, inference_framework="onnx")
keys = list(m.models)
print(f"mic: {sd.query_devices(kind='input')['name']}   models: {', '.join(keys)}   say 'Hey Vegas'")
best, heard, quiet, top = dict.fromkeys(keys, 0.0), False, 0, 0
with sd.InputStream(samplerate=16000, channels=1, dtype="int16", blocksize=1280) as s:
    while True:
        f = s.read(1280)[0][:, 0]
        peak = int(np.abs(f.astype(np.int32)).max())
        scores = m.predict(f)
        for k in keys:
            best[k] = max(best[k], float(scores[k]))
        if peak > 500:
            heard, quiet, top = True, 0, max(top, peak)
        else:
            quiet += 1
        if heard and quiet == 15:  # 1.2 s after speech ends (the model lags by its window): report, then reset
            print(f"speech (level {top}):  " + "  ".join(f"{k} {best[k]:.2f}" for k in keys))
            best, heard, top = dict.fromkeys(keys, 0.0), False, 0
        elif not heard and quiet > 15:
            best = dict.fromkeys(keys, 0.0)
