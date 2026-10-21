import json

import pytest

from bridge.protocol import (ProtocolError, RateLimiter, Smoother, clamp01, to_pixels, validate)


def err(msg):
    with pytest.raises(ProtocolError) as e:
        validate(msg)
    return e.value.code


def test_hello_ok_and_version_mismatch():
    assert validate({"type": "hello", "app": "gestureos", "version": 1})["app"] == "gestureos"
    assert err({"type": "hello", "app": "x", "version": 2}) == "version_mismatch"
    assert err({"type": "hello", "version": 1}) == "bad_field"


def test_schema_rejects_bad_shapes():
    assert err([1, 2]) == "bad_json"
    assert err({}) == "bad_type"
    assert err({"type": "teleport"}) == "unknown_type"
    assert err({"type": "move", "x": "0.5", "y": 0.5}) == "bad_field"
    assert err({"type": "move", "x": float("nan"), "y": 0.5}) == "bad_field"
    assert err({"type": "move", "x": True, "y": 0.5}) == "bad_field"
    assert err({"type": "click", "button": "side"}) == "bad_field"
    assert err({"type": "hotkey", "keys": "ctrl+c"}) == "bad_field"


def test_move_is_clamped():
    m = validate({"type": "move", "x": -0.4, "y": 1.7})
    assert (m["x"], m["y"]) == (0.0, 1.0)


def test_click_defaults():
    m = validate({"type": "click"})
    assert m == {"type": "click", "button": "left", "double": False}


def test_scroll_clamped_and_int():
    m = validate({"type": "scroll", "dx": 2.9, "dy": -999})
    assert (m["dx"], m["dy"]) == (2, -50)


@pytest.mark.parametrize("v,exp", [(-1, 0), (0, 0), (0.25, 0.25), (1, 1), (3, 1)])
def test_clamp01(v, exp):
    assert clamp01(v) == exp


def test_to_pixels_edges():
    assert to_pixels(0, 0, 1920, 1080) == (0, 0)
    assert to_pixels(1, 1, 1920, 1080) == (1919, 1079)
    assert to_pixels(0.5, 0.5, 1920, 1080) == (960, 540)
    assert to_pixels(2, -1, 1920, 1080) == (1919, 0)


def test_smoother():
    s = Smoother(0.5)
    assert s.update(0, 0) == (0, 0)
    assert s.update(1, 1) == (0.5, 0.5)
    assert s.update(1, 1) == (0.75, 0.75)
    assert Smoother(0).update(0.3, 0.4) == (0.3, 0.4)
    assert Smoother(5).alpha == 0.95


def test_key_allowlist():
    assert validate({"type": "key", "key": "ArrowRight"})["key"] == "right"
    assert validate({"type": "key", "key": "Space"})["key"] == "space"
    assert err({"type": "key", "key": "printscreen"}) == "not_allowed"
    assert err({"type": "key", "key": ""}) == "bad_field"


def test_hotkey_allowlist_order_independent():
    assert validate({"type": "hotkey", "keys": ["c", "Control"]})["keys"] == ["c", "ctrl"]
    assert err({"type": "hotkey", "keys": ["alt", "f4"]}) == "not_allowed"
    assert err({"type": "hotkey", "keys": ["ctrl", "alt", "delete"]}) == "not_allowed"


def test_rate_limiter_with_fake_clock():
    t = [0.0]
    rl = RateLimiter(rate=10, burst=3, clock=lambda: t[0])
    assert [rl.allow() for _ in range(4)] == [True, True, True, False]
    t[0] += 0.1  # one token refilled
    assert rl.allow() and not rl.allow()
    t[0] += 10  # refill caps at burst
    assert sum(rl.allow() for _ in range(10)) == 3
