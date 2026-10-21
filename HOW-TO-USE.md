# How to use GestureOS

Open the page from `http://localhost:8000` (run `python -m http.server 8000` in the project folder), press **Start camera**, and allow the webcam. Keep one hand in front of the camera, about 40–60 cm away. Pick a mode from the numbered tabs at the top.

## The gestures
- **Point**: only your index finger is up.
- **Pinch**: touch your thumb tip to your index tip, with the other three fingers relaxed or open. (If all fingers are curled, it counts as a fist, not a pinch.)
- **Open palm**: all five fingers spread.
- **Fist**: all fingers curled.
- **Peace**: index and middle fingers up.
- **Thumbs up**: fist turned sideways, thumb straight up.

## The modes
1. **Air Mouse.** Your index fingertip moves the amber ring around the page. A quick pinch (let go within about half a second) clicks whatever is under the ring. Try it on the A–D boxes; the click counter goes up.
2. **Air Draw.** Pinch (or point) and move to draw. Open your palm to lift the pen. Hold a **thumbs up** for 0.8 s (the small ring fills) or press **Clear** to wipe the canvas. **Save PNG** downloads the drawing.
3. **Slides.** Two ways, both shown on the stage: (a) **point and hold** your index finger at the right edge of the camera frame for 0.6 s to go next, left edge to go back; the arrow fills up while it waits. (b) **Palm swipe**: open hand, sweep it sideways quickly (about a third of a second); the bar shows how fast the swipe is. After each change there is a 0.9 s pause so one move is not counted twice. The Back/Next buttons also work. (The old play/pause/mute and progress slider were removed.)
4. **Sign.** Hold one handshape still for 0.8 s (the ring fills) to type it. Supported: A (fist, thumb at the side), B (four fingers up together, thumb folded), D (index up), I (pinky up), L (index up + thumb out), O (fingers rounded, thumb touching the index tip), V (index + middle apart), W (index, middle, ring up), Y (thumb + pinky out); an open hand with the thumb out types a space. The stage shows the reference card, the closest letter and a confidence. If the hand is between shapes, nothing is typed.
5. **OS Control.** This controls your real Windows mouse through the bridge (see below).
6. **Voice.** Press **Start listening** and allow the microphone (Chrome or Edge only). Say "next", "back", "draw", "mouse", "slides", "sign", "train", "clear" or "stop". The panel shows what it heard and what it did.
7. **Train.** Opens the drawer at the bottom. Type a name, press **Record 60**, and hold the new gesture. The model then recognises it live.

## RUN, idle and the lever
- The **RUN** row shows what the OS mouse is doing right now: `idle`, `move`, `press`, `drag`, `click`, `scroll` or `paused`.
- The **lever** on the right of RUN is the on/off switch for real mouse control. Push it up to arm: it connects to the bridge by itself, and the REC dot, the ARM word and the gate outline turn red or amber. Pull it down to pause.
- **STATE** shows the bridge: `NO BRIDGE`, `CONNECTED · PAUSED` (with the reason, such as kill or watchdog) or `CONNECTED · LIVE`. **BACKEND** shows `pynput`, `pyautogui` or `dry-run`.
- To stop at any time: press **Esc** (page focused), hold a fist for 1 second, take your hand out of view, or press **KILL**. After any stop the lever drops to off and nothing re-arms by itself; push the lever up again to continue.
- **Emergency stop that always works:** with the real bridge (`python -m bridge`, pynput backend) press **F9** or **Esc** in *any* window, even when the browser is not focused. The bridge releases the mouse button and pauses at once. (Disable with `--no-hotkey`.)
- OS control also pauses itself when you switch mode, switch tab or window (the browser loses focus), or when a button stays held with no movement for 1.5 s. So: air-clicking another app's window pauses control; push the lever up again in the browser to continue.
- Only **Air Mouse** and **OS Control** ever send mouse input to the bridge.

## How to test OS control
1. Terminal 1, in the project folder: `python -m http.server 8000`
2. Terminal 2: `pip install -r bridge/requirements.txt`, then first a safe test with `python -m bridge --dry-run`. That run only prints `dry-run move …` and `dry-run mouseDown/mouseUp` lines and does not move anything.
3. Open `http://localhost:8000` in Chrome, press **Start camera**, choose **Air Mouse** or **OS Control**, and push the lever up. STATE should say `CONNECTED · LIVE` and BACKEND `dry-run`.
4. Point and pinch. Terminal 2 should print move and mouseDown/mouseUp lines. Press KILL: the lines stop and the lever drops.
5. When that works, stop the bridge (Ctrl+C) and run `python -m bridge` with no flag to drive the real mouse. Keep Esc ready.

## Layout
The default layout puts the camera (top) over all the readouts (bottom) on the left, and the work area on the right. Press **LAYOUT** in the top bar (or open `?layout=stack`) for camera and work area side by side with the readouts in one band underneath.
