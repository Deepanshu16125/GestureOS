# GestureOS: 90-Second Viva Demo Script

**Setup (before the examiner arrives):** laptop plugged in, good front lighting, Chrome open at `http://localhost:8000` with the camera started once (so MediaPipe is cached). Run `python -m bridge` in a second terminal, have PowerPoint or a slides tab open, and connect the bridge in the OS Control tab (the toggle stays **off**). Rehearse twice.

| Time | Do | Say |
|---|---|---|
| 0–10 s | Click **Start Camera** and raise your hand. Point at the HUD. | "GestureOS tracks 21 hand landmarks in real time, entirely in the browser. The video never leaves this laptop. The HUD shows the mode, gesture, FPS and latency." |
| 10–25 s | **Air Mouse** tab: point to move, then pinch a target. Point at the pinch meter. | "The cursor uses a One Euro filter from CHI 2012, so it's steady when still and responsive when moving. The pinch has hysteresis bands at 0.18 and 0.23, and the click lands where the cursor was 200 ms earlier." |
| 25–45 s | **OS Control**: tick **Enable OS control** (chip turns rust-red). Point and pinch-click a real desktop icon or window. Show a fist for 1 s, and the chip shows paused. | "A local Python bridge receives JSON over WebSocket and moves the real cursor. It starts paused, has a watchdog, and Esc or a fist stops it instantly. Safety is built in." |
| 45–60 s | **Slides** tab (or the real PPT): swipe with an open palm, then give a 👍. | "The same engine drives presentation and media control. Swipe velocity changes slides." |
| 60–75 s | **Train** tab: type `rock`, record 60 samples of 🤘, and show the live prediction. | "Users can add their own gestures. I extract a 73-dimensional scale-invariant feature vector and classify it with k-NN, stored locally. It's a lightweight version of Google's ICCVW 2023 custom-gesture work." |
| 75–90 s | **Sign** tab: hold the signs to type **O-W-L**. | "Finally, an ASL letter subset typed by holding a sign. Future scope includes dynamic letters with sequence models and a Model Maker custom model. Thank you." |

**Backup lines**
- *Why not just OpenCV + PyAutoGUI?* The browser gives zero-install, on-device inference, a PWA that works offline, and one engine for many apps. The bridge is optional and sandboxed.
- *Accuracy?* Show the dashboard numbers and the 20-trial pinch-click table in the README.
- *If the bridge fails:* demo the Air Mouse tab instead. It has the same pipeline, just in-page.
