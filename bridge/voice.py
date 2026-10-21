"""Offline speech commands for GestureOS: Vosk (Kaldi) + sounddevice, inside the bridge.

No browser permission or cloud service is involved: the bridge opens the default Windows
recording device itself and streams {"type":"voice", ...} messages to the page.

Setup (once):  .venv\\Scripts\\python.exe -m pip install vosk sounddevice
               model: models/vosk-model-small-en-us-0.15 (download_model() or README)
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import struct
import threading
import time
import wave

log = logging.getLogger("bridge.voice")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_URL = f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip"
DEFAULT_MODEL = os.path.join(ROOT, "models", MODEL_NAME)
RATE = 16000

# Same command words as js/app.js (SYN). Kept in sync by tests/test_voice.py.
SYN = {
    "stop": ["stop", "pause", "kill", "halt", "freeze", "emergency"],
    "next": ["next", "forward", "ahead", "skip", "next slide"],
    "back": ["back", "previous", "go back", "backward", "before"],
    "clear": ["clear", "erase", "wipe", "reset", "clean"],
    "draw": ["draw", "drawing", "paint", "pen", "air draw"],
    "mouse": ["mouse", "cursor", "pointer", "air mouse"],
    "slides": ["slides", "slide", "presentation", "slideshow"],
    "sign": ["sign", "letters", "spell"],
    "train": ["train", "training", "teach"],
}
ORDER = ["stop", "next", "back", "clear", "draw", "mouse", "slides", "sign", "train"]


def grammar():
    """Restricting Vosk to the command vocabulary makes the small model far more accurate."""
    words = set()
    for k in ORDER:
        for s in SYN[k]:
            words.update(s.split())
    words.update(["go", "the", "canvas", "please", "slide"])
    return json.dumps(sorted(words) + ["[unk]"])


def match_command(text: str):
    """Map a transcript to a command key (stop wins ties: checked first)."""
    t = " " + re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", (text or "").lower())).strip() + " "
    for k in ORDER:
        for s in SYN[k]:
            if f" {s} " in t:
                return k
    return None


def rms_level(pcm: bytes) -> float:
    """0..1 loudness of 16-bit mono PCM (for the page's mic meter)."""
    n = len(pcm) // 2
    if not n:
        return 0.0
    samples = struct.unpack(f"<{n}h", pcm[: n * 2])
    r = math.sqrt(sum(s * s for s in samples) / n) / 32768.0
    return min(1.0, r * 6)


class Recognizer:
    """Wraps a Vosk KaldiRecognizer; feed() returns a list of event dicts."""

    def __init__(self, model_path=DEFAULT_MODEL, use_grammar=True):
        import vosk  # noqa: local import so the bridge runs without it
        vosk.SetLogLevel(-1)
        if not os.path.isdir(model_path):
            raise FileNotFoundError(f"Vosk model not found at {model_path}")
        self.model = vosk.Model(model_path)
        self.rec = vosk.KaldiRecognizer(self.model, RATE, grammar()) if use_grammar else vosk.KaldiRecognizer(self.model, RATE)
        self.last_partial = ""

    def feed(self, pcm: bytes):
        ev = []
        if self.rec.AcceptWaveform(pcm):
            text = json.loads(self.rec.Result()).get("text", "").replace("[unk]", "").strip()
            self.last_partial = ""
            if text:
                ev.append({"type": "voice", "final": True, "text": text, "command": match_command(text)})
        else:
            p = json.loads(self.rec.PartialResult()).get("partial", "").replace("[unk]", "").strip()
            if p and p != self.last_partial:
                self.last_partial = p
                ev.append({"type": "voice", "final": False, "text": p})
        return ev

    def flush(self):
        text = json.loads(self.rec.FinalResult()).get("text", "").replace("[unk]", "").strip()
        return [{"type": "voice", "final": True, "text": text, "command": match_command(text)}] if text else []


def transcribe_wav(path, model_path=DEFAULT_MODEL, use_grammar=True):
    """Run a 16 kHz mono WAV through the same recognizer the mic uses. Returns final events."""
    with wave.open(path, "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, "need 16 kHz mono s16"
        r = Recognizer(model_path, use_grammar)
        out = []
        while True:
            data = w.readframes(4000)
            if not data:
                break
            out += [e for e in r.feed(data) if e["final"]]
        out += r.flush()
    return out


def list_inputs():
    import sounddevice as sd
    return [{"index": i, "name": d["name"], "default": i == sd.default.device[0]}
            for i, d in enumerate(sd.query_devices()) if d["max_input_channels"] > 0]


class MicListener:
    """Background thread: default mic → Vosk → emit(dict). emit must be thread-safe."""

    def __init__(self, emit, model_path=DEFAULT_MODEL, device=None):
        self.emit, self.model_path, self.device = emit, model_path, device
        self.thread = None
        self.running = False

    def start(self):
        if self.running:
            self.emit({"type": "voice_status", "state": "listening", "message": "already listening"})
            return
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False

    def _run(self):
        try:
            rec = Recognizer(self.model_path)
            if not os.environ.get("GESTUREOS_VOICE_WAV"):
                import sounddevice as sd
        except Exception as e:  # missing package / model
            self.running = False
            self.emit({"type": "voice_status", "state": "error", "message": f"offline engine unavailable: {e}"})
            log.warning("voice: %s", e)
            return
        wav = os.environ.get("GESTUREOS_VOICE_WAV")  # test hook: play these WAVs instead of the mic
        if wav:
            self.emit({"type": "voice_status", "state": "listening", "message": "offline (Vosk) · test WAV input"})
            for path in wav.split(os.pathsep):
                with wave.open(path, "rb") as w:
                    while self.running:
                        data = w.readframes(4000)
                        if not data:
                            break
                        self.emit({"type": "voice_level", "level": round(rms_level(data), 3)})
                        for ev in rec.feed(data):
                            self.emit(ev)
                        time.sleep(0.05)
                for ev in rec.flush():
                    self.emit(ev)
                rec = Recognizer(self.model_path)
            self.running = False
            self.emit({"type": "voice_status", "state": "listening", "message": "test WAVs done"})
            return
        try:
            dev = sd.query_devices(self.device if self.device is not None else sd.default.device[0])
            name = dev["name"]
            with sd.RawInputStream(samplerate=RATE, blocksize=4000, dtype="int16", channels=1, device=self.device) as stream:
                self.emit({"type": "voice_status", "state": "listening", "message": f"offline (Vosk) · mic: {name}"})
                log.info("voice: listening on %s", name)
                t_level = 0
                while self.running:
                    data, _ = stream.read(4000)
                    data = bytes(data)
                    now = time.monotonic()
                    if now - t_level > 0.1:
                        t_level = now
                        self.emit({"type": "voice_level", "level": round(rms_level(data), 3)})
                    for ev in rec.feed(data):
                        self.emit(ev)
                        if ev["final"]:
                            log.info("voice heard: %r -> %s", ev["text"], ev.get("command"))
        except Exception as e:
            self.emit({"type": "voice_status", "state": "error", "message": f"microphone error: {e}"})
            log.warning("voice mic error: %s", e)
        finally:
            self.running = False
            self.emit({"type": "voice_status", "state": "stopped", "message": "offline listening stopped"})


def download_model(dest_dir=os.path.join(ROOT, "models")):
    import io, urllib.request, zipfile
    os.makedirs(dest_dir, exist_ok=True)
    if os.path.isdir(os.path.join(dest_dir, MODEL_NAME)):
        return os.path.join(dest_dir, MODEL_NAME)
    log.info("downloading %s", MODEL_URL)
    with urllib.request.urlopen(MODEL_URL) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(dest_dir)
    return os.path.join(dest_dir, MODEL_NAME)


if __name__ == "__main__":  # python -m bridge.voice [--download] [--devices] [file.wav]
    import sys
    if "--download" in sys.argv:
        print(download_model())
    elif "--devices" in sys.argv:
        print(json.dumps(list_inputs(), indent=1))
    else:
        for p in sys.argv[1:]:
            print(p, transcribe_wav(p))
