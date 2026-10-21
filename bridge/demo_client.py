"""Small demo: connects, handshakes, draws a square with the cursor, then disconnects.

    python -m bridge.demo_client          (server must be running)
"""
import asyncio
import json

import websockets


async def main(url="ws://127.0.0.1:8765"):
    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({"type": "hello", "app": "demo", "version": 1}))
        print("<-", await ws.recv())
        for x, y in [(0.3, 0.3), (0.7, 0.3), (0.7, 0.7), (0.3, 0.7), (0.5, 0.5)]:
            await ws.send(json.dumps({"type": "move", "x": x, "y": y}))
            await asyncio.sleep(0.3)
        await ws.send(json.dumps({"type": "ping", "id": 1}))
        print("<-", await ws.recv())


if __name__ == "__main__":
    asyncio.run(main())
