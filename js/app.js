import {HandLandmarker,FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import {features,classify,signLetter,pinchRatio,Smoother,EMA} from './gestures.js';
import {KNN} from './knn.js';
import {BridgeClient} from './bridge.js';
import {OneEuro2D,PinchFSM,mapInner} from './filters.js';
const $=id=>document.getElementById(id);
const video=$('video'),ov=$('overlay'),octx=ov.getContext('2d');
let landmarker=null,mode='cursor',running=false,lastVideoTime=-1;
const smoother=new Smoother(7),knn=new KNN();
// Shared cursor pipeline: inner-70% mapping -> One Euro filter -> pinch FSM (hysteresis + 200 ms lookback).
const cursorF=new OneEuro2D(1.0,0.007),pinch=new PinchFSM();
let curPos=null,pinchEv=[];
const tune=()=>{cursorF.set(+$('minCutoff').value,+$('beta').value);$('minCutoffV').textContent=(+$('minCutoff').value).toFixed(2);$('betaV').textContent=(+$('beta').value).toFixed(3);};
['minCutoff','beta'].forEach(id=>$(id).oninput=tune);tune();
const EMO={open_palm:'🖐 Open Palm',fist:'✊ Fist',point:'☝️ Point',pinch:'🤏 Pinch',thumbs_up:'👍 Thumbs Up',thumbs_down:'👎 Thumbs Down',peace:'✌️ Peace',rock:'🤘 Rock',unknown:'❔ Unknown',none:'— No hand'};
const log=m=>{const li=document.createElement('li');li.textContent=new Date().toLocaleTimeString()+'  '+m;$('log').prepend(li);while($('log').children.length>40)$('log').lastChild.remove();};
// Tabs
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');mode=b.dataset.mode;document.querySelectorAll('.mode').forEach(m=>m.classList.add('hidden'));$('mode-'+mode).classList.remove('hidden');log('Mode → '+mode);});
// Start
$('startBtn').onclick=async()=>{
  if(running)return;$('camMsg').textContent='Loading MediaPipe model…';
  try{
    const fs=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
    const opts=d=>({baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:d},runningMode:'VIDEO',numHands:2});
    try{landmarker=await HandLandmarker.createFromOptions(fs,opts('GPU'));}catch{landmarker=await HandLandmarker.createFromOptions(fs,opts('CPU'));}
    video.srcObject=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480}});
    await video.play();running=true;$('camMsg').style.display='none';$('startBtn').textContent='Camera live';log('Camera + model ready');requestAnimationFrame(loop);
  }catch(e){$('camMsg').textContent='Error: '+e.message+' (needs webcam, internet for first model load, and http://localhost)';}
};
// Perf
let frames=0,fpsT=performance.now(),fpsHist=[];
function perf(lat){frames++;const n=performance.now();$('lat').textContent=lat.toFixed(1)+' ms';
  if(n-fpsT>=500){const f=frames*1000/(n-fpsT);frames=0;fpsT=n;$('fps').textContent=f.toFixed(0);fpsHist.push(f);if(fpsHist.length>52)fpsHist.shift();drawChart();}}
function drawChart(){const c=$('fpsChart'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.strokeStyle='#B06F2C';x.lineWidth=2;x.beginPath();
  fpsHist.forEach((f,i)=>{const px=i*5,py=c.height-Math.min(f,60)/60*c.height;i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();}
const CONN=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(lm){const W=ov.width,H=ov.height;octx.strokeStyle='#E6DAA9';octx.lineWidth=3;
  for(const [a,b] of CONN){octx.beginPath();octx.moveTo(lm[a].x*W,lm[a].y*H);octx.lineTo(lm[b].x*W,lm[b].y*H);octx.stroke();}
  for(const p of lm){octx.beginPath();octx.arc(p.x*W,p.y*H,4.5,0,7);octx.fillStyle='#B06F2C';octx.fill();octx.lineWidth=1.5;octx.strokeStyle='#3B4029';octx.stroke();}}
let prevG='none';
function loop(){
  if(!running)return;
  if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;
    ov.width=video.videoWidth;ov.height=video.videoHeight;
    const t0=performance.now(),res=landmarker.detectForVideo(video,t0),lat=performance.now()-t0;perf(lat);
    octx.clearRect(0,0,ov.width,ov.height);const hands=res.landmarks||[];$('hands').textContent=hands.length;
    let g='none',conf=0,lm=null;pinchEv=[];
    if(hands.length){hands.forEach(drawHand);lm=hands[0];const now=performance.now(),m=mapInner(lm[8].x,lm[8].y);curPos=cursorF.update(m.x,m.y,now);
      pinch.track(curPos,now);pinchEv=pinch.update(pinchRatio(lm),now);
      const r=classify(lm,pinch.closed);g=r.name;conf=r.conf;
      const vec=features(lm);
      if(Object.keys(knn.classes()).length){const p=knn.predict(vec,+$('kVal').value||5);
        if(p){$('knnPred').textContent=p.label;$('knnConf').textContent='('+(p.conf*100).toFixed(0)+'%)';
          if($('useCustom').checked&&p.conf>.8&&p.dist<1.2){g=p.label;conf=p.conf;}}}
      if(recording)record(vec);}
    if(!hands.length){pinchEv=pinch.update(null);cursorF.reset();curPos=null;}
    updatePinchMeter(pinch.ratio,pinch.closed);
    $('raw').textContent=g;const sm=smoother.push(g);$('conf').textContent=(conf*sm.ratio*100).toFixed(0)+'%';
    $('gestureBadge').textContent=EMO[sm.label]||('⭐ '+sm.label);
    if(sm.label!==prevG){if(sm.label!=='none')log('Gesture: '+sm.label);prevG=sm.label;}
    updateHud(sm.label);
    handleMode(sm.label,lm);
  }
  requestAnimationFrame(loop);
}
// ---------- Air Mouse
const pad=$('pad'),vc=$('vcursor');let clicks=0;
function airMouse(g,lm){if(!lm||!curPos)return;const r=pad.getBoundingClientRect();
  const P=q=>({x:q.x*r.width,y:q.y*r.height}),p=P(curPos);vc.style.left=p.x+'px';vc.style.top=p.y+'px';
  vc.classList.toggle('down',pinch.closed);const hit=q=>[...pad.querySelectorAll('.target')].find(t=>{const b=t.getBoundingClientRect(),x=r.left+q.x,y=r.top+q.y;return x>b.left&&x<b.right&&y>b.top&&y<b.bottom;});
  const hov=hit(p);pad.querySelectorAll('.target').forEach(t=>t.classList.toggle('hover',t===hov));
  for(const e of pinchEv)if(e.type==='up'&&e.click&&!e.lost){const q=P(pinch.downPos||curPos),t=hit(q);clickRing();
    if(t){clicks++;$('clickCount').textContent=clicks;t.classList.add('hit');setTimeout(()=>t.classList.remove('hit'),300);log('Click on '+t.textContent);}}}
// ---------- Air Draw
const dc=$('drawCanvas'),dctx=dc.getContext('2d');let last=null,fistT=0;const dEma=new EMA(.5);
dctx.lineCap='round';
function airDraw(g,lm){if(!lm){last=null;return;}
  const p=dEma.update((1-lm[8].x)*dc.width,lm[8].y*dc.height);
  if(g==='point'){if(last){dctx.strokeStyle=$('penColor').value;dctx.lineWidth=+$('penSize').value;dctx.beginPath();dctx.moveTo(last.x,last.y);dctx.lineTo(p.x,p.y);dctx.stroke();}last={...p};}
  else last=null;
  if(g==='fist'){if(!fistT)fistT=performance.now();else if(performance.now()-fistT>1000){dctx.clearRect(0,0,dc.width,dc.height);fistT=0;log('Canvas cleared');}}else fistT=0;}
$('clearDraw').onclick=()=>dctx.clearRect(0,0,dc.width,dc.height);
$('saveDraw').onclick=()=>{const a=document.createElement('a');a.download='airdraw.png';a.href=dc.toDataURL();a.click();};
// ---------- Slides / Media
const SLIDES=[['GestureOS','#3B4029','#ECE8D7'],['On-device ML, privacy first','#F6F2E7','#2B2A1C'],['21 landmarks · 30+ FPS','#DEDBC3','#2B2A1C'],['Custom gestures via k-NN','#B06F2C','#F6F2E7'],['Thank you','#DCDFC6','#B06F2C']];
let si=0,playing=false,muted=false,prog=0,hist=[],cool=0;
function showSlide(){$('slide').textContent=SLIDES[si][0];$('slide').style.background=SLIDES[si][1];$('slide').style.color=SLIDES[si][2];}showSlide();
function slides(g,lm){const now=performance.now();
  if(lm&&g==='open_palm'){hist.push({x:1-lm[0].x,t:now});hist=hist.filter(h=>now-h.t<400);
    if(hist.length>3&&now>cool){const dx=hist.at(-1).x-hist[0].x;
      if(Math.abs(dx)>.18){si=(si+(dx>0?1:-1)+SLIDES.length)%SLIDES.length;showSlide();log('Swipe '+(dx>0?'→':'←')+' slide '+(si+1));hist=[];cool=now+700;}}}else hist=[];
  if(g!==prevAct&&now>cool){if(g==='thumbs_up'){playing=true;log('Play');}if(g==='fist'){playing=false;log('Pause');}if(g==='peace'){muted=!muted;log(muted?'Mute':'Unmute');}}
  prevAct=g;$('mediaState').textContent=playing?'▶ Playing':'⏸ Paused';$('muteState').textContent=muted?'🔇':'🔊';
  if(playing){prog=(prog+.15)%100;$('mediaProg').style.width=prog+'%';}}
let prevAct='';
// ---------- Sign
let sCand=null,sT=0;
function sign(lm){const L=lm?signLetter(lm):null;$('signLetter').textContent=L===' '?'␣':(L||'?');
  if(L!==sCand){sCand=L;sT=performance.now();return;}
  if(L&&performance.now()-sT>800){const t=$('signText');if(!(L===' '&&t.textContent.endsWith(' ')))t.textContent+=L;sT=performance.now()+400;log('Typed "'+L+'"');}}
$('signClear').onclick=()=>$('signText').textContent='';
// ---------- Training
let recording=false,recName='',recN=0;
function record(vec){knn.add(recName,vec);recN++;$('trainStatus').textContent=`Recording "${recName}": ${recN}/60`;
  if(recN>=60){recording=false;knn.save();renderClasses();$('trainStatus').textContent=`Saved 60 samples for "${recName}".`;log('Trained '+recName);}}
$('recBtn').onclick=()=>{const n=$('gName').value.trim();if(!n)return alert('Enter a gesture name');if(!running)return alert('Start the camera first');
  recName=n;recN=0;$('trainStatus').textContent='Get ready… recording in 2s';setTimeout(()=>recording=true,2000);};
function renderClasses(){const ul=$('classList');ul.innerHTML='';for(const [l,c] of Object.entries(knn.classes())){const li=document.createElement('li');const nb=document.createElement('b');nb.textContent=l;li.append(nb,` — ${c} samples `);
  const b=document.createElement('button');b.textContent='✕';b.onclick=()=>{knn.removeClass(l);renderClasses();};li.append(b);ul.append(li);}}
renderClasses();
$('resetBtn').onclick=()=>{if(confirm('Delete all custom gestures?')){knn.reset();renderClasses();}};
$('exportBtn').onclick=()=>{const a=document.createElement('a');a.download='gestureos-model.json';a.href=URL.createObjectURL(new Blob([knn.export()]));a.click();};
$('importFile').onchange=async e=>{try{knn.import(await e.target.files[0].text());renderClasses();log('Model imported');}catch(err){alert(err.message);}};
function handleMode(g,lm){if(mode==='cursor')airMouse(g,lm);else if(mode==='draw')airDraw(g,lm);else if(mode==='slides')slides(g,lm);else if(mode==='sign')sign(lm);else if(mode==='os')osControl(g,lm);}

// ---------- HUD, legend, pinch meter, click ring
const LEGEND={cursor:[['☝️','Point','move cursor'],['🤏','Pinch','click (hold = press)']],
 draw:[['☝️','Point','draw'],['🖐','Open palm','lift pen'],['✊','Fist 1 s','clear']],
 slides:[['🖐','Swipe','next / prev slide'],['👍','Thumbs up','play'],['✊','Fist','pause'],['✌️','Peace','mute']],
 sign:[['🤟','ASL sign','hold 0.8 s to type'],['🖐','Open palm','space']],
 train:[['●','Record','60 samples per class'],['🧠','k-NN','live prediction']],
 os:[['☝️','Point','move OS cursor'],['🤏','Pinch','click (200 ms lookback)'],['🤏⏱','Pinch > 450 ms','drag'],['✌️↕','Peace up/down','scroll'],['✊','Fist 1 s / Esc','pause'],['🖐','Palm 2 s','pause / re-enable']]};
const MODE_NAME={cursor:'Air Mouse',draw:'Air Draw',slides:'Slides/Media',sign:'Sign Letters',train:'Train',os:'OS Control'};
let legendMode=null;
function updateHud(g){$('hudMode').textContent=MODE_NAME[mode];$('hudGesture').textContent=EMO[g]||('⭐ '+g);$('hudFps').textContent=$('fps').textContent;
  if(legendMode!==mode){legendMode=mode;$('legend').innerHTML=LEGEND[mode].map(([i,n,a])=>`<span><b>${i} ${n}</b> → ${a}</span>`).join('');}}
const PMAX=0.5;
(()=>{const m=$('pinchMeter');for(const [v,c] of [[pinch.close,'close'],[pinch.open,'open']]){const l=document.createElement('i');l.className='thr '+c;l.style.left=v/PMAX*100+'%';l.title=c+' '+v;m.append(l);}})();
function updatePinchMeter(r,closed){$('pinchFill').style.width=(r==null?0:Math.min(1,r/PMAX)*100)+'%';$('pinchMeter').classList.toggle('closed',closed);$('pinchVal').textContent=r==null?'—':r.toFixed(2);}
function clickRing(){if(!curPos)return;const w=document.querySelector('.camwrap'),el=document.createElement('div');el.className='ring';
  el.style.left=(curPos.x*70+15)+'%';el.style.top=(curPos.y*70+15)+'%';w.append(el);setTimeout(()=>el.remove(),450);}
document.querySelectorAll('#tabs button').forEach(b=>b.addEventListener('click',()=>updateHud(prevG)));updateHud('none');
// ---------- OS Control (bridge v1.1: server starts paused; toggle = resume, any pause = kill)
const bridge=new BridgeClient();
const killBtn=$('killBtn'),osToggle=$('osEnable');
let bridgeState='disconnected',pauseReason='';
const controlling=()=>bridge.ready&&!bridge.killed&&osToggle.checked;
function renderChip(){const c=$('bridgeChip');let cls='off',t='OS: off';
  if(bridgeState==='connecting'){cls='connecting';t='OS: connecting…';}
  else if(bridge.ready){if(controlling()){cls='live';t='OS: CONTROLLING';}else if(osToggle.checked){cls='connecting';t='OS: resuming…';}else{cls='paused';t='OS: paused'+(pauseReason?' ('+pauseReason+')':'');}}
  c.className='chip '+cls;c.textContent=t;
  $('hudBackend').textContent=bridge.ready?bridge.backend:'—';}
bridge.addListener('log',log);
bridge.addListener('rtt',r=>$('ping').textContent=r.toFixed(1)+' ms');
bridge.addListener('ack',m=>{pauseReason=m.killed?'start':'';
  if(osToggle.checked){bridge.resume();log('OS control enabled → resume');}else if(!m.killed){bridge.kill();}renderChip();});
bridge.addListener('state',({killed,reason})=>{
  if(killed){releaseMouse(false);pauseReason=reason;if(osToggle.checked){osToggle.checked=false;log(`OS control paused by bridge (${reason}). Re-enable to continue.`);}else log(`Bridge paused (${reason})`);}
  else{pauseReason='';log('Bridge resumed');}renderChip();});
bridge.addListener('status',st=>{bridgeState=st;
  if(st!=='connected'&&st!=='killed'){$('ping').textContent='—';releaseMouse(false);if(osToggle.checked){osToggle.checked=false;}}renderChip();});
osToggle.onchange=()=>{if(osToggle.checked){if(bridge.ready){bridge.resume();log('OS control enabled');}else{log('Connect the bridge first');osToggle.checked=false;}}else pauseOS('toggle');renderChip();};
$('bridgeConnect').onclick=()=>bridge.connect($('bridgeUrl').value.trim());
$('bridgeDisconnect').onclick=()=>{pauseOS(null);bridge.disconnect();};
killBtn.onclick=()=>pauseOS('KILL button');
// Open palm 2 s toggles control: pause if live, re-enable if paused.
function toggleKill(){if(!bridge.ready)return log('Bridge not connected');if(controlling())pauseOS('palm');else{osToggle.checked=true;osToggle.onchange();}}
window.addEventListener('keydown',e=>{if(e.key==='Escape')pauseOS('Esc');});
window.addEventListener('beforeunload',()=>{releaseMouse(true);bridge.disconnect(true);});
let mouseIsDown=false,scrollY=null,scrollAcc=0,palmStart=0,palmFired=false,fistStart=0;
const osAct=a=>$('osAction').textContent=a;
function releaseMouse(send){if(mouseIsDown){if(send&&bridge.ready)bridge.raw({type:'mouseUp',button:'left'});mouseIsDown=false;}}
/** Release any held button, send kill (bridge pauses + releases), toggle off. reason=null → silent. */
function pauseOS(reason){releaseMouse(true);const was=osToggle.checked;osToggle.checked=false;
  if(bridge.ready&&!bridge.killed)bridge.kill();if(reason){pauseReason=reason;if(was)log('OS control paused ('+reason+')');}osAct('paused');renderChip();}
function osControl(g,lm){
  const now=performance.now();
  // Open palm held 2 s → bridge kill/resume (works while paused or killed).
  if(g==='open_palm'){if(!palmStart){palmStart=now;palmFired=false;}const f=Math.min(1,(now-palmStart)/2000);$('palmProg').style.width=f*100+'%';
    if(f>=1&&!palmFired){palmFired=true;toggleKill();}}else{palmStart=0;$('palmProg').style.width='0';}
  // Fist held 1 s → pause.
  if(g==='fist'){if(!fistStart)fistStart=now;else if(now-fistStart>1000&&osToggle.checked)pauseOS('fist 1 s');}else fistStart=0;
  // Lost hand → release + pause.
  if(!lm){if(osToggle.checked)pauseOS('hand lost');scrollY=null;return;}
  const live=controlling();
  for(const e of pinchEv){
    if(e.type==='down'){const q=e.pos||curPos;clickRing();if(live){bridge.move(q.x,q.y,true);bridge.mouseDown();mouseIsDown=true;osAct('press');}}
    else if(e.type==='drag'){osAct('drag');}
    else if(e.type==='up'){if(mouseIsDown){bridge.mouseUp();mouseIsDown=false;osAct(e.click?'click':'drop');if(e.click)log('OS click');}}
  }
  // Cursor: point moves; during a pinch only after drag threshold (short pinch = click at lookback position).
  if(live&&curPos&&(g==='point'||(pinch.closed&&pinch.dragging))){bridge.move(curPos.x,curPos.y);if(g==='point')osAct('move');}
  // Peace: vertical motion scrolls.
  if(g==='peace'){const y=(lm[8].y+lm[12].y)/2;if(scrollY!==null){scrollAcc+=(y-scrollY)*60;const n=Math.trunc(scrollAcc);
      if(n!==0){if(live)bridge.scroll(n);scrollAcc-=n;osAct('scroll '+(n>0?'↓':'↑'));}}scrollY=y;}
  else{scrollY=null;scrollAcc=0;}
}
renderChip();
// ---------- PWA
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').then(()=>log('Offline cache ready (service worker)')).catch(e=>console.warn('SW',e));
