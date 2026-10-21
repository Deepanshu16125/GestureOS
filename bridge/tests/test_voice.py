import glob, json, os, re
import pytest
from bridge import voice
from bridge.backends import DryRunBackend
from bridge.server import Controller

AUDIO = os.path.join(os.path.dirname(__file__), "audio")
HAVE_VOSK = True
try:
    import vosk  # noqa
except ImportError:
    HAVE_VOSK = False
need_model = pytest.mark.skipif(not (HAVE_VOSK and os.path.isdir(voice.DEFAULT_MODEL)),
                                reason="vosk or model missing (python -m bridge.voice --download)")


@pytest.mark.parametrize("text,cmd", [("next slide", "next"), ("go back", "back"), ("clear the canvas", "clear"),
                                      ("air draw", "draw"), ("please stop", "stop"), ("stop next", "stop"),
                                      ("presentation", "slides"), ("hello there", None), ("", None)])
def test_match_command(text, cmd):
    assert voice.match_command(text) == cmd


def test_grammar_covers_every_synonym():
    g = set(json.loads(voice.grammar()))
    for k, syns in voice.SYN.items():
        for s in syns:
            assert set(s.split()) <= g


def test_js_and_python_command_sets_match():
    js = open(os.path.join(voice.ROOT, "js", "app.js"), encoding="utf8").read()
    body = js[js.index("const ACT={"):js.index("const lev=")]
    keys = set(re.findall(r"(\w+):\(\)=>\{", body))
    assert keys == set(voice.ORDER)


def test_rms_level():
    assert voice.rms_level(b"") == 0
    assert voice.rms_level(b"\x00\x00" * 100) == 0
    assert voice.rms_level(b"\xff\x7f" * 100) == 1.0


@need_model
@pytest.mark.parametrize("wav,cmd", [("next_slide", "next"), ("go_back", "back"), ("clear", "clear"), ("air_draw", "draw")])
def test_wav_transcription_maps_to_command(wav, cmd):
    ev = voice.transcribe_wav(os.path.join(AUDIO, wav + ".wav"))
    assert ev and ev[-1]["final"]
    assert any(e["command"] == cmd for e in ev), ev


def _ctl():
    c = Controller(DryRunBackend(), start_active=True)
    c.sent = []
    c.broadcast = c.sent.append
    return c


def test_voice_messages_validate_and_work_before_hello():
    c = _ctl()
    r = c.handle(json.dumps({"type": "voice_stop"}), {"ready": False})
    assert r["type"] == "voice_status"


def test_voice_start_without_model_reports_error(monkeypatch):
    c = _ctl()
    monkeypatch.setattr(voice, "DEFAULT_MODEL", "/nonexistent/model")
    r = c.handle(json.dumps({"type": "voice_start"}), {"ready": True})
    assert r["state"] == "error" and "download" in r["message"]


def test_voice_start_uses_listener(monkeypatch):
    started = []
    class Fake:
        def __init__(self, emit): self.emit = emit
        def start(self): started.append(1)
        def stop(self): started.append(0)
    monkeypatch.setattr(voice, "MicListener", Fake)
    monkeypatch.setattr(voice.os.path, "isdir", lambda p: True)
    c = _ctl()
    assert c.handle(json.dumps({"type": "voice_start"}), {"ready": True})["state"] == "starting"
    c.handle(json.dumps({"type": "voice_stop"}), {"ready": True})
    assert started == [1, 0]


def test_spoken_stop_kills_os_control():
    c = _ctl()
    assert not c.killed
    c.voice_emit({"type": "voice", "final": True, "text": "stop", "command": "stop"})
    assert c.killed
    assert {"type": "state", "killed": True, "reason": "voice"} in c.sent
    assert c.sent[-1]["command"] == "stop"
