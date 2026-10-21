// GestureOS service worker: precache app shell + MediaPipe runtime/model, serve cache-first (offline after first load).
const VER='gestureos-v4';
const SHELL=['./','index.html','css/style.css','js/app.js','js/gestures.js','js/knn.js','js/filters.js','js/bridge.js','manifest.webmanifest','icons/icon.svg'];
const MP='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/';
const REMOTE=[MP+'vision_bundle.mjs',MP+'wasm/vision_wasm_internal.js',MP+'wasm/vision_wasm_internal.wasm',MP+'wasm/vision_wasm_nosimd_internal.js',MP+'wasm/vision_wasm_nosimd_internal.wasm',
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'];
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(VER);await c.addAll(SHELL);
  await Promise.allSettled(REMOTE.map(u=>c.add(new Request(u,{mode:'cors'}))));self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==VER)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.protocol.startsWith('ws'))return;
  const remote=u.origin!==location.origin;
  if(!remote){ // app shell: network-first so edits show up, cache fallback offline
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(VER).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true})));return;}
  if(/cdn\.jsdelivr\.net|storage\.googleapis\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host)) // MediaPipe assets: cache-first (immutable, versioned)
    e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(VER).then(c=>c.put(e.request,cp));}return r;})));
});
