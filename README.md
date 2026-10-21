# GestureOS — Privacy-First On-Device Hand Gesture Control

GestureOS turns any laptop webcam into a touch-free controller. It runs Google **MediaPipe Hands** (Tasks Vision, WebAssembly/WebGL) entirely in the browser, so no video ever leaves the device. It needs no server-side AI and no paid APIs.

## Features
- **Real-time hand tracking**: 21 3D landmarks per hand, up to 2 hands, GPU delegate with a CPU fallback.
- **Gesture recognition**: open palm, fist, point, pinch, thumbs up/down, peace, rock. Uses geometric rules plus **majority-vote temporal smoothing**.
- **Air Mouse**: a virtual cursor driven by the index fingertip with EMA jitter filtering. Pinch to click.
- **Air Draw**: point to draw, open palm to lift the pen, hold a fist for 1 s to clear. Export as PNG.
- **Slides & Media**: swipe velocity detection for next/previous slide, thumbs up to play, fist to pause, peace to mute.
- **Sign Letters**: an ASL subset (A B D I L O V W Y, plus space) with hold-to-type.
- **Train custom gestures**: record 60 samples, extract a scale-invariant 73-dim feature vector, and classify with a distance-weighted **k-NN**. The model persists in localStorage and can be exported or imported as JSON.
- **Dashboard**: FPS, inference latency, hand count, raw label, confidence, FPS chart, event log.

## Architecture
```
Webcam → <video> → HandLandmarker (WASM/GPU) → 21 landmarks
   → features.js (wrist-relative, scale-normalized + tip distances)
   → Rule classifier ─┐
   → k-NN (custom)  ──┴→ Smoother (window=7 majority vote) → Mode controller
        → Air Mouse | Air Draw | Slides/Media | Sign | Trainer      → Perf dashboard
```
| File | Role |
|---|---|
| `index.html` | UI layout and tabs |
| `css/style.css` | Dark glassmorphism theme |
| `js/app.js` | Camera, model loading, render loop, mode logic, dashboard |
| `js/gestures.js` | Feature extraction, finger states, rule classifier, ASL letters, Smoother, EMA |
| `js/knn.js` | k-NN classifier with localStorage persistence |

## How to run
```bash
cd gestureos
python -m http.server 8000
# open http://localhost:8000 in Chrome/Edge, click "Start Camera", allow webcam
```
The first load needs internet to fetch MediaPipe (about 8 MB) from the CDN, and after that the browser caches it. The camera works only on `localhost` or HTTPS.

## Tips
Use good, even lighting and keep your hand 40–80 cm from the camera. Facing the palm toward the camera gives the best sign-letter results.
