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


class PynputBackend:
    """Default backend: low-latency input via pynput."""
    name = "pynput"

    def __init__(self):
        from pynput import keyboard, mouse  # lazy: needs a display on Linux

        self.mouse, self.kb = mouse.Controller(), keyboard.Controller()
        self.Button, self.Key = mouse.Button, keyboard.Key
        self.held: set[str] = set()
        self._size = None

    def screen_size(self):
        if self._size is None:
            self._size = _screen_size()
        return self._size

    def move(self, x, y):
        self.mouse.position = (x, y)

    def click(self, button, double=False):
        self.mouse.click(getattr(self.Button, button), 2 if double else 1)

    def mouse_down(self, button):
        self.mouse.press(getattr(self.Button, button))
        self.held.add(button)

    def mouse_up(self, button):
        self.mouse.release(getattr(self.Button, button))
        self.held.discard(button)

    def scroll(self, dx, dy):
        # Protocol: positive dy = down. pynput: positive dy = up.
        self.mouse.scroll(dx, -dy)

    def _key(self, name):
        if len(name) == 1:
            return name
        special = {"esc": "esc", "win": "cmd", "command": "cmd", "volumemute": "media_volume_mute",
                   "volumeup": "media_volume_up", "volumedown": "media_volume_down",
                   "playpause": "media_play_pause", "nexttrack": "media_next",
                   "prevtrack": "media_previous", "pageup": "page_up", "pagedown": "page_down"}
        if name in ("plus", "minus"):
            return "+" if name == "plus" else "-"
        return getattr(self.Key, special.get(name, name))

    def key(self, key):
        k = self._key(key)
        self.kb.press(k)
        self.kb.release(k)

    def hotkey(self, keys):
        ks = [self._key(k) for k in keys]
        for k in ks:
            self.kb.press(k)
        for k in reversed(ks):
            self.kb.release(k)

    def release_all(self):
        for b in list(self.held):
            self.mouse.release(getattr(self.Button, b))
        self.held.clear()


def _screen_size():
    """Screen size without pyautogui where possible."""
    if sys.platform.startswith("win"):
        import ctypes

        u = ctypes.windll.user32
        try:
            u.SetProcessDPIAware()
        except Exception:
            pass
        return int(u.GetSystemMetrics(0)), int(u.GetSystemMetrics(1))
    try:
        import pyautogui

        w, h = pyautogui.size()
        return int(w), int(h)
    except Exception:
        try:
            import tkinter

            r = tkinter.Tk()
            r.withdraw()
            w, h = r.winfo_screenwidth(), r.winfo_screenheight()
            r.destroy()
            return int(w), int(h)
        except Exception:
            return 1920, 1080


def has_display() -> bool:
    if sys.platform.startswith("win") or sys.platform == "darwin":
        return True
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))


BACKENDS = {"pynput": PynputBackend, "pyautogui": PyAutoGUIBackend}


def make_backend(choice: str = "auto", dry_run: bool = False):
    """choice: auto | pynput | pyautogui | dryrun.

    auto tries pynput, then pyautogui. Any failure or missing display falls back to dry-run."""
    if dry_run or choice == "dryrun" or os.environ.get("GESTUREOS_DRY_RUN") == "1":
        return DryRunBackend()
    if not has_display():
        log.warning("No display found; using dry-run backend")
        return DryRunBackend()
    order = ["pynput", "pyautogui"] if choice == "auto" else [choice]
    for name in order:
        try:
            return BACKENDS[name]()
        except Exception as e:  # missing package, no X access, etc.
            log.warning("%s unavailable (%s)", name, e)
    log.warning("Using dry-run backend")
    return DryRunBackend()
