# GestureOS Bridge

A small local server that lets the GestureOS browser app control the real mouse and keyboard.
The browser sends JSON messages over a WebSocket (`ws://localhost:8765`); the bridge checks them and sends input through pynput (default) or PyAutoGUI.
The bridge starts **paused**: the page must send `resume` before anything moves.
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
   python -m bridge                  # real mouse/keyboard (pynput, else pyautogui)
   python -m bridge --backend pyautogui
   python -m bridge --dry-run -v     # log only, nothing moves
   python -m bridge --smoothing 0.4  # smoother cursor
   ```
4. In a second terminal serve the app: `python -m http.server 8000`, then open http://localhost:8000.
5. Windows Defender Firewall: the bridge only listens on 127.0.0.1, so no inbound rule is needed. If a firewall prompt appears, allowing **Private networks** is enough (or Cancel; localhost still works).

Note: Windows does not let normal apps send input to windows running as Administrator (e.g. Task Manager). Run the bridge as admin only if you need that.

## Platform notes
- **Windows:** works with no extra setup.
- **macOS:** give your terminal (or Python) Accessibility permission: System Settings → Privacy & Security → Accessibility. Without it, input is silently ignored.
- **Linux:** needs X11 and `python3-xlib` (installed by requirements.txt; `sudo apt install python3-tk python3-dev` may help pyautogui). Wayland is limited: input injection usually only works for XWayland apps, so log into an X11 session for the demo.

## Options
| flag | default | meaning |
|---|---|---|
| `--host` | 127.0.0.1 | bind address; keep it local |
| `--port` | 8765 | |
| `--backend` | auto | `auto` (pynput, then pyautogui), `pynput`, `pyautogui`, `dryrun` |
| `--dry-run` | off | same as `--backend dryrun` (also `GESTUREOS_DRY_RUN=1`) |
| `--start-active` | off | accept input without a `resume` (testing only) |
| `--watchdog` | 1.5 | seconds of silence while active before auto-pause (0 = off) |
| `--smoothing` | 0 | cursor EMA weight 0–0.95 |
| `--rate` | 120 | max messages per second |
| `--allow-origin` | — | extra browser Origin allowed to connect (repeatable) |
| `-v` | off | debug logging |

If there is no display (e.g. a Linux server) or neither pynput nor PyAutoGUI loads, the bridge falls back to dry-run and says so in the log.

## Stopping it
- Send `{"type":"kill"}` (input off until `{"type":"resume"}`).
- Stop sending messages: the watchdog pauses after 1.5 s and releases held buttons.
- With `--backend pyautogui`: move the real mouse into any screen corner (fail-safe → kill).
- Ctrl+C in the terminal.

## Trying it without the app
- Open `bridge/test_client.html` in a browser, click Connect, move over the box.
- Or `python -m bridge.demo_client` draws a square with the cursor.

## Files
| file | role |
|---|---|
| `server.py` | WebSocket server, CLI, `Controller` (handshake, kill switch, rate limit) |
| `protocol.py` | message validation, allowlists, clamping, smoothing, rate limiter |
| `backends.py` | `PynputBackend` (default), `PyAutoGUIBackend` (fallback), `DryRunBackend` (records calls) |
| `demo_client.py`, `test_client.html` | manual test clients |
| `tests/` | pytest suite — run `python -m pytest bridge` from the `gestureos` folder |
