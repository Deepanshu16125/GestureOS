# GestureOS Bridge Protocol — version 1

Changes since the first release are additions only (`ack.backend`, `ack.watchdog`, `state.reason`); v1 clients keep working, but note that the server now **starts paused**.

Transport: WebSocket, `ws://localhost:8765` (server binds 127.0.0.1 only).
Every frame is one JSON object with a string `type`. Any message may carry an optional `id`; error replies echo it back as `ref`, and pong echoes it as `id`.
Frames are capped at 4 KB.

## Handshake
Client must send `hello` before any input command (otherwise `error/not_ready`).

| Direction | Message |
|---|---|
| C → S | `{"type":"hello","app":"gestureos","version":1}` |
| S → C | `{"type":"ack","version":1,"screen":{"w":1920,"h":1080},"dryRun":false,"killed":true,"backend":"pynput","watchdog":1.5}` |
| C → S | `{"type":"resume"}` — required before any input; the server starts paused (unless run with `--start-active`) |

A different `version` returns `error/version_mismatch`.

## Input commands (no reply on success)
| type | fields | notes |
|---|---|---|
| `move` | `x`, `y` (number, 0–1) | Fraction of the screen, 0,0 = top-left. Values outside 0–1 are clamped. Server applies optional EMA smoothing (`--smoothing`). Mirror the webcam x on the client (`x = 1 - lm.x`) if needed. |
| `click` | `button`: `left`\|`right`\|`middle` (default left), `double`: bool (default false) | |
| `mouseDown` / `mouseUp` | `button` (default left) | For drag: pinch start → mouseDown, moves, pinch end → mouseUp. Held buttons are released on kill or disconnect. |
| `scroll` | `dx`, `dy` (integers, clamped to ±50) | Positive `dy` scrolls down, positive `dx` scrolls right. One unit ≈ one wheel notch. |
| `key` | `key` (string) | Must be in the key allowlist. Browser names like `ArrowRight`, `Escape`, `" "` are mapped. |
| `hotkey` | `keys` (list of 2–4 strings) | Combo must be in the hotkey allowlist (order does not matter). |

Key allowlist: arrows, `pageup pagedown home end space enter esc tab backspace delete`, `volumeup volumedown volumemute playpause nexttrack prevtrack`, `f5 f11`, modifiers `ctrl shift alt win`, `a–z`, `0–9`, `plus minus`.

Hotkey allowlist: `ctrl+c/v/x/z/y/a/s/t/w`, `ctrl+tab`, `ctrl+shift+tab`, `alt+tab`, `shift+f5`, `ctrl+plus`, `ctrl+minus`, `win+d`.
(Edit `ALLOWED_KEYS` / `ALLOWED_HOTKEYS` in `protocol.py` to change.)

## Control
| C → S | S → C |
|---|---|
| `{"type":"kill"}` | `{"type":"state","killed":true,"reason":"kill"}` — all input ignored (replies `error/killed`) and held buttons released, for every client, until resume. |
| `{"type":"resume"}` | `{"type":"state","killed":false,"reason":"resume"}` |
| — | `{"type":"state","killed":true,"reason":"watchdog"}` — pushed by the server when the watchdog pauses input |
| `{"type":"ping","id":1}` | `{"type":"pong","id":1}` |
| `{"type":"bye"}` | none |

`hello`, `ping`, `kill`, `resume` always work, even when killed or rate-limited.

## Safety
- Starts paused: nothing reaches the OS until the client sends `resume` (the UI's "Enable OS control").
- Watchdog: once input has been sent since the last resume, if no message of any kind arrives for `watchdog` seconds (default 1.5, `--watchdog`), the server releases held buttons, pauses, and broadcasts `state/watchdog`. Clients should `ping` about every 500 ms while connected; send `resume` again to continue.
- Binds to 127.0.0.1; browser connections are accepted only from allowed Origins (`http://localhost:8000`, `http://127.0.0.1:8000`, ports 5500, and `null` for a file opened from disk). Add more with `--allow-origin`.
- Global rate limit: token bucket, default 120 msgs/s with a burst of 60. Excess input gets `error/rate_limited` (send `move` at most once per video frame).
- PyAutoGUI fail-safe (only with the pyautogui backend; the default pynput backend has no corner trap): moving the real mouse into a screen corner raises an error; the bridge turns that into a kill (`error/failsafe`). Send `resume` to continue.

## Errors
`{"type":"error","code":"<code>","message":"<text>","ref":<id if given>}`

| code | when |
|---|---|
| `bad_json` | frame is not a JSON object |
| `bad_type` | missing `type` |
| `unknown_type` | unsupported `type` |
| `bad_field` | wrong or missing field |
| `version_mismatch` | hello with another protocol version |
| `not_ready` | input before hello |
| `not_allowed` | key/hotkey not in allowlist |
| `killed` | input while kill switch is on |
| `rate_limited` | over the rate limit |
| `failsafe` | PyAutoGUI corner fail-safe tripped |
| `backend_error` | OS input call failed |

## Minimal JS client
```js
const ws = new WebSocket('ws://localhost:8765');
let bridge = {killed: true};
const send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
ws.onopen = () => send({type:'hello', app:'gestureos', version:1});
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'ack') { bridge = m; send({type:'resume'}); }   // or wait for an "Enable OS control" toggle
  else if (m.type === 'state') bridge.killed = m.killed;           // reason: kill | resume | watchdog
  else if (m.type === 'error') console.warn(m);
};
const keepAlive = setInterval(() => send({type:'ping'}), 500);
ws.onclose = () => clearInterval(keepAlive);
// per frame: send({type:'move', x: 1 - tip.x, y: tip.y});
// pinch edge: send({type:'click', button:'left'});
// Esc / fist: send({type:'kill'});
```
