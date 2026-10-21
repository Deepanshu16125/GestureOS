"""Input backends. PyAutoGUI does real input; DryRun only records calls."""
from __future__ import annotations

import logging
import os
import sys

log = logging.getLogger("bridge")


class DryRunBackend:
    name = "dry-run"

    def __init__(self, size=(1920, 1080)):
        self.size = size
        self.calls: list[tuple] = []

    def screen_size(self):
        return self.size

    def move(self, x, y):
        self.calls.append(("move", x, y))

    def click(self, button, double=False):
        self.calls.append(("click", button, double))

    def mouse_down(self, button):
        self.calls.append(("mouseDown", button))

    def mouse_up(self, button):
        self.calls.append(("mouseUp", button))

    def scroll(self, dx, dy):
        self.calls.append(("scroll", dx, dy))

    def key(self, key):
        self.calls.append(("key", key))

    def hotkey(self, keys):
        self.calls.append(("hotkey", tuple(keys)))

    def release_all(self):
        self.calls.append(("releaseAll",))


class PyAutoGUIBackend:
    name = "pyautogui"

    def __init__(self):
        import pyautogui  # imported lazily so tests and dry-run never need a display

        pyautogui.FAILSAFE = True  # slam the mouse into a screen corner to abort
        pyautogui.PAUSE = 0  # we rate-limit ourselves
        self.g = pyautogui
        self.held: set[str] = set()

    def screen_size(self):
        w, h = self.g.size()
        return int(w), int(h)

    def move(self, x, y):
        self.g.moveTo(x, y, _pause=False)

    def click(self, button, double=False):
        self.g.click(button=button, clicks=2 if double else 1, interval=0.05)

    def mouse_down(self, button):
        self.g.mouseDown(button=button)
        self.held.add(button)

    def mouse_up(self, button):
        self.g.mouseUp(button=button)
        self.held.discard(button)

    def scroll(self, dx, dy):
        # Protocol: positive dy = scroll down. PyAutoGUI: positive = up.
        if dy:
            self.g.scroll(-dy * 40)
        if dx:
            self.g.hscroll(dx * 40)

    def key(self, key):
        self.g.press(key)

    def hotkey(self, keys):
        self.g.hotkey(*keys)

    def release_all(self):
        for b in list(self.held):
            self.g.mouseUp(button=b)
        self.held.clear()


def has_display() -> bool:
    if sys.platform.startswith("win") or sys.platform == "darwin":
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


def make_backend(dry_run: bool):
    if dry_run or os.environ.get("GESTUREOS_DRY_RUN") == "1":
        return DryRunBackend()
    if not has_display():
        log.warning("No display found; using dry-run backend")
        return DryRunBackend()
    try:
        return PyAutoGUIBackend()
    except Exception as e:  # missing package, no X access, etc.
        log.warning("PyAutoGUI unavailable (%s); using dry-run backend", e)
        return DryRunBackend()
