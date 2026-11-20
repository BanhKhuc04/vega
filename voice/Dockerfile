# vega-voice: Piper text-to-speech, offline (M5). Build context is the repository root:
#   docker build -f voice/Dockerfile -t vega-voice .
FROM python:3.12-slim
# arm64 (Pi) and amd64 wheels exist for piper-tts and onnxruntime: nothing to compile
RUN pip install --no-cache-dir piper-tts==1.8.0
# the voices are baked into the image (~130 MB): the Pi speaks without internet
RUN python -m piper.download_voices --data-dir /voices vi_VN-vais1000-medium en_US-lessac-medium
COPY voice/server.py /app/server.py
USER nobody
ENV VOICE_DIR=/voices PORT=5002 PYTHONUNBUFFERED=1
EXPOSE 5002
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5002/health')"
CMD ["python", "/app/server.py"]
