# GestureOS Bridge

A small local server that lets the GestureOS browser app control the real mouse and keyboard.
The browser sends JSON messages over a WebSocket (`ws://localhost:8765`); the bridge checks them and calls PyAutoGUI.
Protocol details: [PROTOCOL.md](PROTOCOL.md).

## Windows setup
1. Install Python 3.10+ from python.org (tick **Add python.exe to PATH**).
2. Open PowerShell in the `gestureos` folder (the one that contains `bridge\`):
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1      # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   pip install -r bridge\requirements.txt
   ```
3. Start the bridge:
   ```powershell
   python -m bridge                  # real mouse/keyboard
   python -m bridge --dry-run -v     # log only, nothing moves
   python -m bridge --smoothing 0.4  # smoother cursor
   ```
4. In a second terminal serve the app: `python -m http.server 8000`, then open http://localhost:8000.
5. Windows Defender Firewall: the bridge only listens on 127.0.0.1, so no inbound rule is needed. If a firewall prompt appears, allowing **Private networks** is enough (or Cancel; localhost still works).

Note: Windows does not let normal apps send input to windows running as Administrator (e.g. Task Manager). Run the bridge as admin only if you need that.

## Options
| flag | default | meaning |
|---|---|---|
| `--host` | 127.0.0.1 | bind address; keep it local |
| `--port` | 8765 | |
| `--dry-run` | off | record calls instead of real input (also `GESTUREOS_DRY_RUN=1`) |
| `--smoothing` | 0 | cursor EMA weight 0–0.95 |
| `--rate` | 120 | max messages per second |
| `--allow-origin` | — | extra browser Origin allowed to connect (repeatable) |
| `-v` | off | debug logging |

If there is no display (e.g. a Linux server) or PyAutoGUI fails to load, the bridge falls back to dry-run and says so in the log.

## Stopping it
- Send `{"type":"kill"}` (input off until `{"type":"resume"}`).
- Move the real mouse into any screen corner (PyAutoGUI fail-safe → kill).
- Ctrl+C in the terminal.

## Trying it without the app
- Open `bridge/test_client.html` in a browser, click Connect, move over the box.
- Or `python -m bridge.demo_client` draws a square with the cursor.

## Files
| file | role |
|---|---|
| `server.py` | WebSocket server, CLI, `Controller` (handshake, kill switch, rate limit) |
| `protocol.py` | message validation, allowlists, clamping, smoothing, rate limiter |
| `backends.py` | `PyAutoGUIBackend` (real input) and `DryRunBackend` (records calls) |
| `demo_client.py`, `test_client.html` | manual test clients |
| `tests/` | pytest suite — run `python -m pytest bridge` from the `gestureos` folder |
