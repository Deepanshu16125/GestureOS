"""Websocket server: ws://127.0.0.1:8765 by default.

Run:  python -m bridge [--dry-run] [--port 8765] [--smoothing 0.3]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys

if __package__ in (None, ""):  # allow `python bridge/server.py`
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "bridge"

import websockets

from . import PROTOCOL_VERSION
from .backends import DryRunBackend, make_backend
from .protocol import ProtocolError, RateLimiter, Smoother, to_pixels, validate

log = logging.getLogger("bridge")

DEFAULT_ORIGINS = {
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5500", "http://127.0.0.1:5500",
    "null",  # test_client.html opened from disk
}


def error(code, message, ref=None):
    msg = {"type": "error", "code": code, "message": message}
    if ref is not None:
        msg["ref"] = ref
    return msg


class Controller:
    """Shared state for all connections: backend, kill switch, rate limit."""

    def __init__(self, backend, smoothing=0.0, rate=120, burst=60, clock=None):
        self.backend = backend
        self.smoother = Smoother(smoothing)
        kw = {"clock": clock} if clock else {}
        self.limiter = RateLimiter(rate, burst, **kw)
        self.killed = False

    @property
    def dry_run(self):
        return isinstance(self.backend, DryRunBackend)

    def kill(self):
        self.killed = True
        self.smoother.reset()
        try:
            self.backend.release_all()
        except Exception:
            log.exception("release_all failed")

    def handle(self, raw, session) -> dict | None:
        """Process one raw text frame. Returns a reply dict or None."""
        try:
            msg = json.loads(raw)
        except (ValueError, TypeError):
            return error("bad_json", "frame is not valid JSON")
        ref = msg.get("id") if isinstance(msg, dict) else None
        try:
            m = validate(msg)
        except ProtocolError as e:
            return error(e.code, e.message, ref)
        t = m["type"]

        # These always work, even when killed or rate-limited.
        if t == "ping":
            return {"type": "pong", "id": ref} if ref is not None else {"type": "pong"}
        if t == "hello":
            session["ready"] = True
            w, h = self.backend.screen_size()
            return {"type": "ack", "version": PROTOCOL_VERSION, "screen": {"w": w, "h": h},
                    "dryRun": self.dry_run, "killed": self.killed}
        if t == "kill":
            self.kill()
            log.warning("Kill switch ON")
            return {"type": "state", "killed": True}
        if t == "resume":
            self.killed = False
            log.info("Kill switch OFF")
            return {"type": "state", "killed": False}
        if t == "bye":
            return None

        if not session.get("ready"):
            return error("not_ready", "send hello first", ref)
        if self.killed:
            return error("killed", "input disabled; send resume", ref)
        if not self.limiter.allow():
            return error("rate_limited", "too many messages", ref)

        try:
            self._apply(m)
        except Exception as e:
            if type(e).__name__ == "FailSafeException":
                self.kill()
                return error("failsafe", "mouse hit a screen corner; input disabled, send resume", ref)
            log.exception("backend error")
            return error("backend_error", str(e), ref)
        return None  # input commands are fire-and-forget

    def _apply(self, m):
        b, t = self.backend, m["type"]
        if t == "move":
            x, y = self.smoother.update(m["x"], m["y"])
            w, h = b.screen_size()
            b.move(*to_pixels(x, y, w, h))
        elif t == "click":
            b.click(m["button"], m["double"])
        elif t == "mouseDown":
            b.mouse_down(m["button"])
        elif t == "mouseUp":
            b.mouse_up(m["button"])
        elif t == "scroll":
            b.scroll(m["dx"], m["dy"])
        elif t == "key":
            b.key(m["key"])
        elif t == "hotkey":
            b.hotkey(m["keys"])


async def serve(controller, host="127.0.0.1", port=8765, origins=None):
    """Start the server; returns the websockets Server object."""
    allowed = set(DEFAULT_ORIGINS if origins is None else origins)

    async def handler(ws):
        origin = ws.request.headers.get("Origin")
        if origin is not None and "*" not in allowed and origin not in allowed:
            await ws.close(code=1008, reason="origin not allowed")
            return
        session = {"ready": False}
        log.info("client connected (%s)", origin or "no origin")
        try:
            async for raw in ws:
                reply = controller.handle(raw, session)
                if reply is not None:
                    await ws.send(json.dumps(reply))
        except websockets.ConnectionClosed:
            pass
        finally:
            # Never leave a mouse button stuck down after a disconnect.
            try:
                controller.backend.release_all()
            except Exception:
                pass
            log.info("client disconnected")

    return await websockets.serve(handler, host, port, max_size=4096)


def parse_args(argv=None):
    p = argparse.ArgumentParser(prog="python -m bridge", description="GestureOS local input bridge")
    p.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1, local only)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--dry-run", action="store_true", help="log input instead of moving the real mouse")
    p.add_argument("--smoothing", type=float, default=0.0, help="cursor EMA weight 0-0.95 (0 = off)")
    p.add_argument("--rate", type=float, default=120, help="max messages per second (default 120)")
    p.add_argument("--allow-origin", action="append", default=None,
                   help="extra allowed browser Origin (repeatable, '*' allows any)")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args(argv)


def main(argv=None):
    a = parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    if a.host not in ("127.0.0.1", "localhost", "::1"):
        log.warning("Binding to %s exposes mouse/keyboard control to the network", a.host)
    backend = make_backend(a.dry_run)
    ctl = Controller(backend, smoothing=a.smoothing, rate=a.rate, burst=max(1, int(a.rate // 2)))
    origins = DEFAULT_ORIGINS | set(a.allow_origin or [])

    async def run():
        server = await serve(ctl, a.host, a.port, origins)
        log.info("GestureOS bridge on ws://%s:%d  backend=%s  smoothing=%.2f",
                 a.host, a.port, backend.name, ctl.smoother.alpha)
        await server.wait_closed()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("stopped")


if __name__ == "__main__":
    main()
