import asyncio
import json

import websockets

from bridge.backends import DryRunBackend
from bridge.server import Controller, serve


def make(**kw):
    return Controller(DryRunBackend((1000, 500)), **kw)


def send(ctl, session, msg):
    return ctl.handle(json.dumps(msg), session)


HELLO = {"type": "hello", "app": "test", "version": 1}


def test_requires_hello():
    ctl, s = make(), {}
    assert send(ctl, s, {"type": "click"})["code"] == "not_ready"
    ack = send(ctl, s, HELLO)
    assert ack == {"type": "ack", "version": 1, "screen": {"w": 1000, "h": 500},
                   "dryRun": True, "killed": False}
    assert send(ctl, s, {"type": "click"}) is None
    assert ctl.backend.calls == [("click", "left", False)]


def test_bad_json_and_error_ref():
    ctl, s = make(), {}
    assert ctl.handle("{nope", s)["code"] == "bad_json"
    r = send(ctl, s, {"type": "key", "key": "f4", "id": 7})
    assert r == {"type": "error", "code": "not_allowed", "message": "key 'f4' is not in the allowlist", "ref": 7}


def test_move_maps_to_pixels_with_smoothing():
    ctl, s = make(smoothing=0.5), {}
    send(ctl, s, HELLO)
    send(ctl, s, {"type": "move", "x": 0, "y": 0})
    send(ctl, s, {"type": "move", "x": 1, "y": 1})
    assert ctl.backend.calls == [("move", 0, 0), ("move", 500, 250)]


def test_kill_and_resume():
    ctl, s = make(), {}
    send(ctl, s, HELLO)
    send(ctl, s, {"type": "mouseDown"})
    assert send(ctl, s, {"type": "kill"}) == {"type": "state", "killed": True}
    assert ("releaseAll",) in ctl.backend.calls  # held buttons released
    assert send(ctl, s, {"type": "click"})["code"] == "killed"
    assert send(ctl, s, {"type": "ping"}) == {"type": "pong"}  # ping still works
    assert send(ctl, s, {"type": "resume"}) == {"type": "state", "killed": False}
    assert send(ctl, s, {"type": "click"}) is None


def test_kill_is_shared_across_sessions():
    ctl, a, b = make(), {}, {}
    send(ctl, a, HELLO); send(ctl, b, HELLO)
    send(ctl, a, {"type": "kill"})
    assert send(ctl, b, {"type": "scroll", "dy": 1})["code"] == "killed"


def test_rate_limit():
    t = [0.0]
    ctl, s = make(rate=10, burst=5, clock=lambda: t[0]), {}
    send(ctl, s, HELLO)
    replies = [send(ctl, s, {"type": "move", "x": 0.5, "y": 0.5}) for _ in range(7)]
    assert replies[:5] == [None] * 5
    assert replies[5]["code"] == replies[6]["code"] == "rate_limited"
    assert send(ctl, s, {"type": "kill"})["killed"] is True  # kill bypasses the limit


def test_failsafe_triggers_kill():
    class FailSafeException(Exception):
        pass

    class Boom(DryRunBackend):
        def click(self, *a):
            raise FailSafeException()

    ctl, s = Controller(Boom()), {}
    send(ctl, s, HELLO)
    assert send(ctl, s, {"type": "click"})["code"] == "failsafe"
    assert ctl.killed


def test_end_to_end_websocket():
    async def run():
        ctl = make()
        server = await serve(ctl, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        try:
            async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
                await ws.send(json.dumps(HELLO))
                ack = json.loads(await ws.recv())
                assert ack["type"] == "ack" and ack["dryRun"] is True
                await ws.send(json.dumps({"type": "move", "x": 0.5, "y": 0.5}))
                await ws.send(json.dumps({"type": "click", "button": "right", "double": True}))
                await ws.send(json.dumps({"type": "hotkey", "keys": ["alt", "tab"]}))
                await ws.send(json.dumps({"type": "key", "key": "f4"}))
                e = json.loads(await ws.recv())
                assert e["type"] == "error" and e["code"] == "not_allowed"
                await ws.send(json.dumps({"type": "ping", "id": "p1"}))
                assert json.loads(await ws.recv()) == {"type": "pong", "id": "p1"}
            # Disallowed browser origin is refused.
            async with websockets.connect(f"ws://127.0.0.1:{port}", origin="http://evil.example") as ws:
                try:
                    await asyncio.wait_for(ws.recv(), 2)
                    assert False, "expected close"
                except websockets.ConnectionClosed as c:
                    assert c.rcvd.code == 1008
        finally:
            server.close()
            await server.wait_closed()
        assert ctl.backend.calls[:3] == [("move", 500, 250), ("click", "right", True), ("hotkey", ("alt", "tab"))]

    asyncio.run(run())
