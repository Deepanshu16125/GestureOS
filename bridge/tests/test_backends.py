import sys
import types

import pytest

from bridge import backends
from bridge.backends import DryRunBackend, make_backend


class FakeA:
    name = "pynput"


class FakeB:
    name = "pyautogui"


def broken():
    raise ImportError("not installed")


@pytest.fixture
def env(monkeypatch):
    monkeypatch.delenv("GESTUREOS_DRY_RUN", raising=False)
    monkeypatch.setattr(backends, "has_display", lambda: True)
    monkeypatch.setattr(backends, "BACKENDS", {"pynput": FakeA, "pyautogui": FakeB})
    return monkeypatch


def test_auto_prefers_pynput(env):
    assert make_backend("auto").name == "pynput"


def test_auto_falls_back_to_pyautogui(env):
    env.setattr(backends, "BACKENDS", {"pynput": broken, "pyautogui": FakeB})
    assert make_backend("auto").name == "pyautogui"


def test_auto_falls_back_to_dryrun(env):
    env.setattr(backends, "BACKENDS", {"pynput": broken, "pyautogui": broken})
    assert isinstance(make_backend("auto"), DryRunBackend)


def test_explicit_choice(env):
    assert make_backend("pyautogui").name == "pyautogui"
    assert isinstance(make_backend("dryrun"), DryRunBackend)
    assert isinstance(make_backend("pynput", dry_run=True), DryRunBackend)


def test_env_flag_and_no_display(env):
    env.setenv("GESTUREOS_DRY_RUN", "1")
    assert isinstance(make_backend("pynput"), DryRunBackend)
    env.delenv("GESTUREOS_DRY_RUN")
    env.setattr(backends, "has_display", lambda: False)
    assert isinstance(make_backend("auto"), DryRunBackend)


def test_pyautogui_settings(monkeypatch):
    fake = types.SimpleNamespace(FAILSAFE=False, PAUSE=0.1, size=lambda: (800, 600))
    monkeypatch.setitem(sys.modules, "pyautogui", fake)
    b = backends.PyAutoGUIBackend()
    assert fake.PAUSE == 0 and fake.FAILSAFE is True and b.screen_size() == (800, 600)


def test_pynput_backend_with_fake_module(monkeypatch):
    log = []

    class Btn:
        left, right, middle = "L", "R", "M"

    class Key:
        esc, cmd, media_next = "ESC", "CMD", "NEXT"

    class Mouse:
        position = None
        def click(self, b, n): log.append(("click", b, n))
        def press(self, b): log.append(("press", b))
        def release(self, b): log.append(("release", b))
        def scroll(self, dx, dy): log.append(("scroll", dx, dy))

    class Kb:
        def press(self, k): log.append(("kp", k))
        def release(self, k): log.append(("kr", k))

    mouse = types.SimpleNamespace(Controller=Mouse, Button=Btn)
    keyboard = types.SimpleNamespace(Controller=Kb, Key=Key)
    monkeypatch.setitem(sys.modules, "pynput", types.SimpleNamespace(mouse=mouse, keyboard=keyboard))
    monkeypatch.setitem(sys.modules, "pynput.mouse", mouse)
    monkeypatch.setitem(sys.modules, "pynput.keyboard", keyboard)
    b = backends.PynputBackend()
    b.move(10, 20)
    assert b.mouse.position == (10, 20)
    b.click("right", True); b.mouse_down("left"); b.scroll(0, 3)
    b.key("nexttrack"); b.hotkey(["win", "d"]); b.release_all()
    assert log == [("click", "R", 2), ("press", "L"), ("scroll", 0, -3), ("kp", "NEXT"), ("kr", "NEXT"),
                   ("kp", "CMD"), ("kp", "d"), ("kr", "d"), ("kr", "CMD"), ("release", "L")]
