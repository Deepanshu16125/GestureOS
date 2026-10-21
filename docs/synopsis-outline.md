# GestureOS: Synopsis Outline

**Abstract**: GestureOS is a browser-based, privacy-preserving human–computer interaction system that recognises hand gestures in real time from a standard webcam. It uses MediaPipe's hand landmark model on-device (WebAssembly/WebGL), a rule-based classifier with temporal smoothing, and a user-trainable k-NN classifier. With these it provides touch-free cursor control, air drawing, presentation/media control and basic sign-language letter typing. No data leaves the user's machine.

**Objectives**
1. Detect and track hand landmarks at 25+ FPS on commodity laptops.
2. Classify static and dynamic gestures (including swipes) robustly, using smoothing.
3. Let users train custom gestures without coding or a server.
4. Demonstrate practical applications: air mouse, air canvas, slide control, sign letters.
5. Measure performance (FPS, latency) live.

**Tech stack**: HTML5, CSS3, JavaScript (ES modules), MediaPipe Tasks Vision (HandLandmarker), WebAssembly/WebGL, Canvas API, getUserMedia, localStorage. Python http.server is used for local hosting only.

**Modules**
1. Video Acquisition
2. Landmark Detection
3. Feature Engineering (normalised 73-D vector)
4. Rule Classifier + Smoother
5. k-NN Trainer
6. Application Modes (Air Mouse, Air Draw, Slides/Media, Sign)
7. Performance Dashboard

**Future scope**: full ASL alphabet with dynamic letters (J, Z) using LSTM/Transformer sequence models; OS-level mouse control via a native helper (Electron/Python); multi-user and gaze fusion; accessibility integration for motor-impaired users; a PWA for offline use; gesture control for IoT/smart-home devices.
