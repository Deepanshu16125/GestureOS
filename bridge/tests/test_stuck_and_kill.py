"""Stuck-button and kill-path safety (Dee's laptop test, 21 Oct)."""
import json

from bridge.backends import DryRunBackend
from bridge.server import Controller


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def setup():
    clk = Clock()
    b = DryRunBackend()
    c = Controller(b, clock=clk, watchdog=1.5)
    s = {}
    c.handle(json.dumps({"type": "hello", "app": "t", "version": 1}), s)
    c.handle(json.dumps({"type": "resume"}), s)
    return c, b, s, clk


def send(c, s, **m):
    return c.handle(json.dumps(m), s)


def test_kill_releases_held_button_immediately():
    c, b, s, _ = setup()
    send(c, s, type="mouseDown", button="left")
    assert b.held == {"left"}
    send(c, s, type="kill")
    assert b.held == set() and ("releaseAll",) in b.calls


def test_pings_alone_do_not_keep_a_held_button_down():
    c, b, s, clk = setup()
    send(c, s, type="mouseDown", button="left")
    for i in range(1, 5):  # page switched mode mid-drag but keeps pinging
        clk.t = i * 0.5
        send(c, s, type="ping", id=i)
    assert c.check_watchdog() is True
    assert c.killed and b.held == set()


def test_no_input_accepted_after_kill_until_resume():
    c, b, s, _ = setup()
    send(c, s, type="kill")
    n = len(b.calls)
    r = send(c, s, type="move", x=0.5, y=0.5)
    assert r["code"] == "killed" and len(b.calls) == n


def test_emergency_stop_kills_and_broadcasts():
    c, b, s, _ = setup()
    out = []
    c.broadcast = out.append
    send(c, s, type="mouseDown", button="left")
    c.emergency_stop("hotkey F9")
    assert c.killed and b.held == set()
    assert out == [{"type": "state", "killed": True, "reason": "hotkey F9"}]


def test_click_is_paired_down_up_and_leaves_nothing_held():
    c, b, s, _ = setup()
    send(c, s, type="mouseDown", button="left")
    send(c, s, type="mouseUp", button="left")
    assert [x[0] for x in b.calls[-2:]] == ["mouseDown", "mouseUp"] and b.held == set()
