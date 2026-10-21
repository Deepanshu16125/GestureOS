"""Message validation, allowlists, and cursor math. No I/O here."""
from __future__ import annotations

import math
import time

from . import PROTOCOL_VERSION

BUTTONS = {"left", "right", "middle"}

# Keys the browser may press. Anything else is rejected.
ALLOWED_KEYS = {
    "left", "right", "up", "down", "pageup", "pagedown", "home", "end",
    "space", "enter", "esc", "tab", "backspace", "delete",
    "volumeup", "volumedown", "volumemute",
    "playpause", "nexttrack", "prevtrack",
    "f5", "f11",
    "ctrl", "shift", "alt", "win", "command",
    *"abcdefghijklmnopqrstuvwxyz",
    *"0123456789",
}

# Hotkey combos allowed, stored as frozensets so order does not matter.
ALLOWED_HOTKEYS = {
    frozenset(c) for c in [
        ("ctrl", "c"), ("ctrl", "v"), ("ctrl", "x"), ("ctrl", "z"), ("ctrl", "y"),
        ("ctrl", "a"), ("ctrl", "s"), ("ctrl", "t"), ("ctrl", "w"),
        ("ctrl", "tab"), ("ctrl", "shift", "tab"),
        ("alt", "tab"), ("shift", "f5"),
        ("ctrl", "plus"), ("ctrl", "minus"),
        ("win", "d"),
    ]
}
ALLOWED_KEYS |= {"plus", "minus"}

MAX_SCROLL = 50


class ProtocolError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _num(msg, field):
    v = msg.get(field)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ProtocolError("bad_field", f"'{field}' must be a finite number")
    return float(v)


def clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def to_pixels(x: float, y: float, w: int, h: int) -> tuple[int, int]:
    """Map normalized 0-1 coords to integer pixels inside the screen."""
    return round(clamp01(x) * (w - 1)), round(clamp01(y) * (h - 1))


def normalize_key(k) -> str:
    if not isinstance(k, str) or not k:
        raise ProtocolError("bad_field", "key must be a non-empty string")
    k = k.lower()
    aliases = {"escape": "esc", "arrowleft": "left", "arrowright": "right",
               "arrowup": "up", "arrowdown": "down", " ": "space", "return": "enter",
               "control": "ctrl", "meta": "win"}
    return aliases.get(k, k)


def validate(msg) -> dict:
    """Check shape and types; return a cleaned copy. Raises ProtocolError."""
    if not isinstance(msg, dict):
        raise ProtocolError("bad_json", "message must be a JSON object")
    t = msg.get("type")
    if not isinstance(t, str):
        raise ProtocolError("bad_type", "missing 'type'")
    out = {"type": t}
    if "id" in msg:
        out["id"] = msg["id"]

    if t == "hello":
        app, ver = msg.get("app"), msg.get("version")
        if not isinstance(app, str):
            raise ProtocolError("bad_field", "'app' must be a string")
        if not isinstance(ver, int) or isinstance(ver, bool):
            raise ProtocolError("bad_field", "'version' must be an integer")
        if ver != PROTOCOL_VERSION:
            raise ProtocolError("version_mismatch", f"server speaks version {PROTOCOL_VERSION}, got {ver}")
        out.update(app=app, version=ver)
    elif t == "move":
        out.update(x=clamp01(_num(msg, "x")), y=clamp01(_num(msg, "y")))
    elif t == "click":
        b = msg.get("button", "left")
        if b not in BUTTONS:
            raise ProtocolError("bad_field", "button must be left, right or middle")
        out.update(button=b, double=bool(msg.get("double", False)))
    elif t in ("mouseDown", "mouseUp"):
        b = msg.get("button", "left")
        if b not in BUTTONS:
            raise ProtocolError("bad_field", "button must be left, right or middle")
        out.update(button=b)
    elif t == "scroll":
        dx, dy = msg.get("dx", 0), msg.get("dy", 0)
        out.update(
            dx=max(-MAX_SCROLL, min(MAX_SCROLL, int(_num({"dx": dx}, "dx")))),
            dy=max(-MAX_SCROLL, min(MAX_SCROLL, int(_num({"dy": dy}, "dy")))),
        )
    elif t == "key":
        k = normalize_key(msg.get("key"))
        if k not in ALLOWED_KEYS:
            raise ProtocolError("not_allowed", f"key '{k}' is not in the allowlist")
        out.update(key=k)
    elif t == "hotkey":
        keys = msg.get("keys")
        if not isinstance(keys, list) or not 2 <= len(keys) <= 4:
            raise ProtocolError("bad_field", "keys must be a list of 2-4 strings")
        keys = [normalize_key(k) for k in keys]
        if frozenset(keys) not in ALLOWED_HOTKEYS:
            raise ProtocolError("not_allowed", f"hotkey {'+'.join(keys)} is not in the allowlist")
        out.update(keys=keys)
    elif t in ("kill", "resume", "ping", "bye"):
        pass
    elif t in ("voice_start", "voice_stop", "voice_devices"):
        pass
    else:
        raise ProtocolError("unknown_type", f"unknown message type '{t}'")
    return out


class Smoother:
    """Exponential moving average on the cursor. alpha=0 disables smoothing.

    alpha is the weight kept from the previous position (0..0.95)."""

    def __init__(self, alpha: float = 0.0):
        self.alpha = max(0.0, min(0.95, alpha))
        self.pos: tuple[float, float] | None = None

    def update(self, x: float, y: float) -> tuple[float, float]:
        if self.pos is None or self.alpha == 0:
            self.pos = (x, y)
        else:
            a = self.alpha
            px, py = self.pos
            self.pos = (a * px + (1 - a) * x, a * py + (1 - a) * y)
        return self.pos

    def reset(self):
        self.pos = None


class RateLimiter:
    """Token bucket: `rate` messages per second, bursts up to `burst`."""

    def __init__(self, rate: float = 120, burst: int = 60, clock=time.monotonic):
        self.rate, self.burst, self.clock = rate, burst, clock
        self.tokens = float(burst)
        self.last = clock()

    def allow(self) -> bool:
        now = self.clock()
        self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
