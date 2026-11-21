# syntax=docker/dockerfile:1.7
# vega-vision: the camera, live video and YOLO on the Pi (M7.1, brief 0011). Build context is the repository root:
#   docker build -f vision/Dockerfile -t vega-vision .
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends v4l-utils && rm -rf /var/lib/apt/lists/*
# arm64 (Pi) and amd64 wheels exist for all three: nothing to compile. Versions as benchmarked on the Pi (2026-11-21).
RUN pip install --no-cache-dir onnxruntime==1.32.0 opencv-python-headless==5.1.0.95 numpy==2.5.5
# YOLOX-Nano (Apache-2.0, Megvii): fixed at build time and checked, nothing is downloaded at run time (L9)
ADD --checksum=sha256:c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d --chmod=644 \
    https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx /models/yolox_nano.onnx
# ADD from a URL left the model unreadable for `nobody` on the Pi's Docker (onnxruntime: system error 13)
RUN chmod -R a+rX /models
COPY vision/server.py vision/detector.py /app/
# CAMERA=sim streams this sample photo
COPY brain/fixtures/desk.jpg /app/desk.jpg
WORKDIR /app
USER nobody
ENV PORT=8092 PYTHONUNBUFFERED=1
EXPOSE 8092
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8092/health')"
CMD ["python", "/app/server.py"]
