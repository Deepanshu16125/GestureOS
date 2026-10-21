import {features,classify,signInfo,pinchRatio,Smoother,EMA} from './gestures.js';
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
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');if(b.dataset.mode!==mode&&typeof pauseOS==='function')pauseOS('mode change');mode=b.dataset.mode;document.body.classList.toggle('drawer-open',mode==='train');document.querySelectorAll('.mode').forEach(m=>m.classList.add('hidden'));$('mode-'+mode).classList.remove('hidden');log('Mode → '+mode);});
// Layout: split (default) or stack (?layout=stack)
const setLayout=l=>{document.body.classList.toggle('stack',l==='stack');$('layoutBtn').querySelector('b').textContent=l==='stack'?'STACK':'SPLIT';
  const u=new URL(location.href);if(l==='stack')u.searchParams.set('layout','stack');else u.searchParams.delete('layout');history.replaceState(null,'',u);};
setLayout(new URLSearchParams(location.search).get('layout')==='stack'?'stack':'split');
$('layoutBtn').onclick=()=>setLayout(document.body.classList.contains('stack')?'split':'stack');
// Drawer (trainer) + bezel clocks
const tab=m=>document.querySelector(`#tabs button[data-mode="${m}"]`).click();
$('drawerBtn').onclick=()=>tab(mode==='train'?'cursor':'train');$('drawerClose').onclick=()=>tab('cursor');
const t0Page=performance.now();let frameCt=0;
setInterval(()=>{const t=(performance.now()-t0Page)/1000,p=n=>String(Math.floor(n)).padStart(2,'0');$('tc').textContent=`${p(t/3600)}:${p(t/60%60)}:${p(t%60)}:${p(t*24%24)}`;},1000/24);
const NAME=g=>g==='none'?'NO HAND':String(g).replace(/_/g,' ').toUpperCase();
// Start
$('startBtn').onclick=async()=>{
  if(running)return;$('camMsg').textContent='Loading MediaPipe model…';
  try{
    const {HandLandmarker,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
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
function drawChart(){const c=$('fpsChart'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.strokeStyle='#8C8F7F';x.lineWidth=1;x.beginPath();
  fpsHist.forEach((f,i)=>{const px=i*(c.width/51),py=c.height-1-Math.min(f,60)/60*(c.height-2);i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();}
const CONN=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(lm){const W=ov.width,H=ov.height;octx.strokeStyle='#9AA87A';octx.lineWidth=Math.max(1,W/640);
  for(const [a,b] of CONN){octx.beginPath();octx.moveTo(lm[a].x*W,lm[a].y*H);octx.lineTo(lm[b].x*W,lm[b].y*H);octx.stroke();}
  for(const p of lm){octx.beginPath();octx.arc(p.x*W,p.y*H,2,0,7);octx.fillStyle='#C9D3A6';octx.fill();}}
let prevG='none',prevRaw=null;
function loop(){
  if(!running)return;
  if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;frameCt++;$('frameCt').textContent=String(frameCt).padStart(6,'0');
    ov.width=video.videoWidth;ov.height=video.videoHeight;
    const t0=performance.now(),res=landmarker.detectForVideo(video,t0),lat=performance.now()-t0;perf(lat);
    processHands(res.landmarks||[]);
  }
  requestAnimationFrame(loop);
}
/** One frame of the gesture pipeline. Also driven by window.GestureOS.feed() for tests. */
function processHands(hands){
    octx.clearRect(0,0,ov.width,ov.height);$('hands').textContent=hands.length;
    let g='none',conf=0,lm=null;pinchEv=[];
    if(hands.length){hands.forEach(drawHand);lm=hands[0];const now=performance.now(),m=mapInner(lm[8].x,lm[8].y);curPos=cursorF.update(m.x,m.y,now);
      pinch.track(curPos,now);pinchEv=pinch.update(pinchRatio(lm),now);
      const r=classify(lm,pinch.closed,prevRaw);prevRaw=r.name;g=r.name;conf=r.conf;
      const vec=features(lm);
      if(Object.keys(knn.classes()).length){const p=knn.predict(vec,+$('kVal').value||5);
        if(p){$('knnPred').textContent=p.label;$('knnConf').textContent='('+(p.conf*100).toFixed(0)+'%)';
          if($('useCustom').checked&&p.conf>.8&&p.dist<1.2){g=p.label;conf=p.conf;}}}
      if(recording)record(vec);}
    if(!hands.length){pinchEv=pinch.update(null);cursorF.reset();curPos=null;}
    updatePinchMeter(pinch.ratio,pinch.closed);
    $('raw').textContent=g;const sm=smoother.push(g);$('conf').textContent=(conf*sm.ratio*100).toFixed(0)+'%';
    $('gestureBadge').textContent=NAME(sm.label);
    if(sm.label!==prevG){if(sm.label!=='none')log('Gesture: '+sm.label);prevG=sm.label;}
    updateHud(sm.label);
    handleMode(sm.label,lm);
    return sm.label;
}
// ---------- Air Mouse: the fingertip drives a page cursor; a pinch clicks the element under it.
const pad=$('pad'),vc=$('vcursor'),pc=$('pageCursor');let clicks=0;
pad.querySelectorAll('.target').forEach(t=>t.addEventListener('click',()=>{clicks++;$('clickCount').textContent=clicks;t.classList.add('hit');setTimeout(()=>t.classList.remove('hit'),300);log('Click on '+t.textContent);}));
const toPage=q=>({x:q.x*innerWidth,y:q.y*innerHeight});
function airMouse(g,lm){if(!lm||!curPos){pc.classList.add('hidden');return;}
  const p=toPage(curPos);pc.classList.remove('hidden');pc.style.left=p.x+'px';pc.style.top=p.y+'px';pc.classList.toggle('down',pinch.closed);
  const r=pad.getBoundingClientRect();vc.style.left=(p.x-r.left)+'px';vc.style.top=(p.y-r.top)+'px';
  const under=document.elementFromPoint(p.x,p.y);pad.querySelectorAll('.target').forEach(t=>t.classList.toggle('hover',t===under));
  for(const e of pinchEv)if(e.type==='up'&&e.click&&!e.lost){const q=toPage(pinch.downPos||curPos),el=document.elementFromPoint(q.x,q.y);clickRing();
    if(el&&el!==document.body){el.click();if(el.matches('input,textarea'))el.focus();log('Air click → '+(el.id?'#'+el.id:el.tagName.toLowerCase()+(el.textContent?` "${el.textContent.trim().slice(0,16)}"`:'')));}}}
// ---------- Air Draw
const dc=$('drawCanvas'),dctx=dc.getContext('2d');let last=null,fistT=0;const dEma=new EMA(.5);
dctx.lineCap='round';
function airDraw(g,lm){if(!lm){last=null;return;}
  const p=dEma.update((1-lm[8].x)*dc.width,lm[8].y*dc.height);
  if(g==='pinch'||g==='point'){if(last){dctx.strokeStyle=$('penColor').value;dctx.lineWidth=+$('penSize').value;dctx.beginPath();dctx.moveTo(last.x,last.y);dctx.lineTo(p.x,p.y);dctx.stroke();}last={...p};}
  else last=null;
  // thumbs up held 0.8 s clears (ring shows progress)
  if(g==='thumbs_up'){if(!fistT)fistT=performance.now();const f=Math.min(1,(performance.now()-fistT)/800);$('drawHold').style.setProperty('--p',f);$('drawHold').classList.add('on');
    if(f>=1){clearDraw();fistT=Infinity;}}else{fistT=0;$('drawHold').classList.remove('on');}}
const clearDraw=()=>{dctx.clearRect(0,0,dc.width,dc.height);log('Canvas cleared');};$('clearDraw').onclick=clearDraw;
$('saveDraw').onclick=()=>{const a=document.createElement('a');a.download='airdraw.png';a.href=dc.toDataURL();a.click();};
// ---------- Slides: point-and-hold at an edge, or a quick open-palm swipe
const SLIDES=[['GestureOS','#161714','#E4E2D4'],['On-device ML, privacy first','#E4E2D4','#0C0D0B'],['21 landmarks per hand','#1C1D19','#C4A035'],['Custom gestures via k-NN','#C4A035','#0C0D0B'],['Thank you','#0C0D0B','#E4E2D4']];
let si=0,hist=[],cool=0;
function showSlide(){$('slide').textContent=SLIDES[si][0];$('slideNo').textContent=(si+1)+' / '+SLIDES.length;$('slide').style.background=SLIDES[si][1];$('slide').style.color=SLIDES[si][2];}showSlide();
const flash=dir=>{const el=$(dir>0?'arrowNext':'arrowPrev');el.classList.add('fire');setTimeout(()=>el.classList.remove('fire'),350);};
const goSlide=k=>{si=(si+k+SLIDES.length)%SLIDES.length;showSlide();flash(k);log('Slide '+(si+1)+'/'+SLIDES.length);};
$('slidePrev').onclick=()=>goSlide(-1);$('slideNext').onclick=()=>goSlide(1);let edgeT=0,edgeDir=0;
const HOLD_MS=600,SWIPE_MS=300,SWIPE_DX=0.22,COOL_MS=900;
function holdUI(dir,f){for(const [id,d] of [['arrowPrev',-1],['arrowNext',1]]){const el=$(id);el.style.setProperty('--p',d===dir?f:0);el.classList.toggle('arming',d===dir&&f>0);}}
function slides(g,lm){const now=performance.now();
  // 1) point and hold at the left / right edge of the camera frame
  if(lm&&g==='point'){const x=1-lm[8].x,dir=x<0.25?-1:x>0.75?1:0;
    if(dir&&dir===edgeDir){const f=Math.min(1,(now-edgeT)/HOLD_MS);holdUI(dir,now>cool?f:0);if(f>=1&&now>cool){goSlide(dir);cool=now+COOL_MS;edgeT=now;}}
    else{edgeDir=dir;edgeT=now;holdUI(0,0);}}else{edgeDir=0;holdUI(0,0);}
  // 2) open-palm swipe: wrist x velocity over ~300 ms
  if(lm&&g==='open_palm'){hist.push({x:1-lm[0].x,t:now});hist=hist.filter(h=>now-h.t<=SWIPE_MS);
    if(hist.length>=3&&now>cool){const dx=hist.at(-1).x-hist[0].x;$('swipeMeter').style.setProperty('--p',Math.min(1,Math.abs(dx)/SWIPE_DX));$('swipeMeter').dataset.dir=dx>0?'→':'←';
      if(Math.abs(dx)>SWIPE_DX){log('Swipe '+(dx>0?'→':'←'));goSlide(dx>0?1:-1);hist=[];cool=now+COOL_MS;}}}
  else{hist=[];$('swipeMeter').style.setProperty('--p',0);}}
// ---------- Sign: hold a letter steady ~0.8 s to type it
let sCand=null,sT=0;
function sign(lm){const r=lm?signInfo(lm):{letter:null,closest:null,conf:0};const L=r.letter;
  $('signLetter').textContent=L===' '?'␣':(L||'?');$('signClosest').textContent=r.closest?(r.closest===' '?'space':r.closest):'—';$('signConf').textContent=lm?(r.conf*100).toFixed(0)+'%':'—';
  document.querySelectorAll('#signCard li').forEach(li=>li.classList.toggle('on',li.dataset.l===(L||'')));
  if(L!==sCand){sCand=L;sT=performance.now();$('signHold').style.setProperty('--p',0);return;}
  if(L){const f=Math.min(1,(performance.now()-sT)/800);$('signHold').style.setProperty('--p',f);
    if(f>=1){const t=$('signText');if(!(L===' '&&t.textContent.endsWith(' ')))t.textContent+=L;sT=performance.now()+400;log('Typed "'+L+'"');}}}
$('signClear').onclick=()=>$('signText').textContent='';
// ---------- Training
let recording=false,recName='',recN=0;
function record(vec){knn.add(recName,vec);recN++;$('trainStatus').textContent=`Recording "${recName}": ${recN}/60`;
  if(recN>=60){recording=false;knn.save();renderClasses();$('trainStatus').textContent=`Saved 60 samples for "${recName}".`;log('Trained '+recName);}}
$('recBtn').onclick=()=>{const n=$('gName').value.trim();if(!n)return alert('Enter a gesture name');if(!running)return alert('Start the camera first');
  recName=n;recN=0;$('trainStatus').textContent='Get ready… recording in 2s';setTimeout(()=>recording=true,2000);};
function renderClasses(){const ul=$('classList');ul.innerHTML='';for(const [l,c] of Object.entries(knn.classes())){const li=document.createElement('li');const nb=document.createElement('b');nb.textContent=l;li.append(nb,` — ${c} samples `);
  const b=document.createElement('button');b.textContent='✕';b.onclick=()=>{knn.removeClass(l);renderClasses();};li.append(b);ul.append(li);}$('takes').textContent=Object.keys(knn.classes()).length;}
renderClasses();
$('resetBtn').onclick=()=>{if(confirm('Delete all custom gestures?')){knn.reset();renderClasses();}};
$('exportBtn').onclick=()=>{const a=document.createElement('a');a.download='gestureos-model.json';a.href=URL.createObjectURL(new Blob([knn.export()]));a.click();};
$('importFile').onchange=async e=>{try{knn.import(await e.target.files[0].text());renderClasses();log('Model imported');}catch(err){alert(err.message);}};
function handleMode(g,lm){if(mode==='cursor')airMouse(g,lm);else if(mode==='draw')airDraw(g,lm);else if(mode==='slides')slides(g,lm);else if(mode==='sign')sign(lm);else if(mode==='os')osControl(g,lm);
  if(mode==='cursor'&&osToggle.checked)osControl(g,lm);
  if(mouseIsDown&&!OS_MODES.has(mode))releaseMouse(true);}

// ---------- HUD, legend, pinch meter, click ring
const LEGEND={cursor:[['☝️','Point','move cursor'],['🤏','Pinch','click (hold = press)']],
 draw:[['🤏','Pinch / point','draw'],['🖐','Open palm','lift pen'],['👍','Thumbs up 0.8 s','clear']],
 slides:[['☝️','Point + hold at edge','next / back'],['🖐','Palm swipe','next / back']],
 sign:[['🤟','Letter','hold 0.8 s to type'],['🖐','Open hand + thumb','space']],
 train:[['●','Record','60 samples per class'],['🧠','k-NN','live prediction']],
 voice:[['🎙','Say','next · back · draw · mouse · slides · clear · stop']],
 os:[['☝️','Point','move OS cursor'],['🤏','Pinch','click (200 ms lookback)'],['🤏⏱','Pinch > 450 ms','drag'],['✌️↕','Peace up/down','scroll'],['✊','Fist 1 s / Esc','pause'],['🖐','Palm 2 s','pause / re-enable']]};
const MODE_NAME={voice:'Voice',cursor:'Air Mouse',draw:'Air Draw',slides:'Slides',sign:'Sign Letters',train:'Train',os:'OS Control'};
let legendMode=null;
const GKEY=n=>{n=n.toLowerCase();return /pinch/.test(n)?'pinch':/point/.test(n)?'point':/palm|swipe/.test(n)?'open_palm':/fist/.test(n)?'fist':/thumbs/.test(n)?'thumbs_up':/peace/.test(n)?'peace':'';};
function updateHud(g){$('hudMode').textContent=MODE_NAME[mode];$('hudGesture').textContent=NAME(g).toLowerCase();$('hudFps').textContent=String(Math.min(999,+$('fps').textContent||0)).padStart(3,'0');
  if(legendMode!==mode){legendMode=mode;$('legend').innerHTML=LEGEND[mode].map(([i,n,a],k)=>`<div data-g="${GKEY(n)}"><i>${String(k+1).padStart(2,'0')}</i>${n}<em>→ ${a}</em></div>`).join('');}
  $('legend').querySelectorAll('div').forEach(d=>d.classList.toggle('on',!!d.dataset.g&&d.dataset.g===g));}
const PMAX=0.8;
(()=>{const m=$('pinchMeter');for(const [v,c] of [[pinch.close,'close'],[pinch.open,'open']]){const l=document.createElement('i');l.className='thr '+c;l.style.left=v/PMAX*100+'%';l.title=c+' '+v;m.append(l);}})();
function updatePinchMeter(r,closed){$('pinchFill').style.width=(r==null?0:Math.min(1,r/PMAX)*100)+'%';$('pinchMeter').classList.toggle('closed',closed);$('pinchVal').textContent=r==null?'—':r.toFixed(2);}
function clickRing(){if(!curPos)return;const w=document.querySelector('.camwrap'),el=document.createElement('div');el.className='ring';
  el.style.left=(curPos.x*70+15)+'%';el.style.top=(curPos.y*70+15)+'%';w.append(el);setTimeout(()=>el.remove(),450);}
document.querySelectorAll('#tabs button').forEach(b=>b.addEventListener('click',()=>updateHud(prevG)));updateHud('none');
// ---------- OS Control (bridge v1.1: server starts paused; toggle = resume, any pause = kill)
const bridge=new BridgeClient();
const killBtn=$('killBtn'),osToggle=$('osEnable');
let bridgeState='disconnected',pauseReason='';
const OS_MODES=new Set(['cursor','os']);
const controlling=()=>bridge.ready&&!bridge.killed&&osToggle.checked&&OS_MODES.has(mode);
function renderChip(){const c=$('bridgeChip');let cls='off',t='NO BRIDGE';
  if(bridgeState==='connecting'){cls='connecting';t='CONNECTING…';}
  else if(bridge.ready){if(controlling()){cls='live';t='CONNECTED · LIVE';}else if(osToggle.checked){cls='connecting';t='RESUMING…';}else{cls='paused';t='CONNECTED · PAUSED'+(pauseReason?' ('+pauseReason+')':'');}}
  $('bridgeState').textContent=t;
  c.className='chip '+cls;c.textContent=t;const armed=controlling();document.body.classList.toggle('armed',armed);
  $('armCap').textContent=armed?'live · real mouse':(bridge.ready?'linked · paused':'off');
  $('hudBackend').textContent=bridge.ready?bridge.backend:'—';}
bridge.addListener('log',log);
bridge.addListener('rtt',r=>$('ping').textContent=r.toFixed(1)+' ms');
bridge.addListener('ack',m=>{pauseReason=m.killed?'start':'';
  if(osToggle.checked){bridge.resume();log('OS control enabled → resume');}else if(!m.killed){bridge.kill();}renderChip();});
bridge.addListener('state',({killed,reason})=>{
  if(killed){releaseMouse(false);pauseReason=reason;if(osToggle.checked){osToggle.checked=false;log(`OS control paused by bridge (${reason}). Re-enable to continue.`);}else log(`Bridge paused (${reason})`);}
  else{pauseReason='';log('Bridge resumed');}renderChip();});
bridge.addListener('status',st=>{bridgeState=st;
  if(st==='disconnected'||st==='error'){if(osToggle.checked)log('No bridge at '+$('bridgeUrl').value+' — run: python -m bridge');$('ping').textContent='—';releaseMouse(false);if(osToggle.checked){osToggle.checked=false;}}renderChip();});
osToggle.onchange=()=>{if(osToggle.checked){if(bridge.ready){bridge.resume();log('OS control enabled');}else{log('Lever on → connecting to bridge…');bridge.connect($('bridgeUrl').value.trim());}}else pauseOS('toggle');renderChip();};
$('bridgeConnect').onclick=()=>bridge.connect($('bridgeUrl').value.trim());
$('bridgeDisconnect').onclick=()=>{pauseOS(null);bridge.disconnect();};
killBtn.onclick=()=>pauseOS('KILL button');
// Open palm 2 s toggles control: pause if live, re-enable if paused.
function toggleKill(){if(osToggle.checked||mouseIsDown)pauseOS('palm 2 s');}
window.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='F9'){e.preventDefault();pauseOS(e.key);}},true);
window.addEventListener('blur',()=>pauseOS('window blur'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseOS('tab hidden');});
window.addEventListener('beforeunload',()=>{releaseMouse(true);bridge.disconnect(true);});
let mouseIsDown=false,scrollY=null,scrollAcc=0,palmStart=0,palmFired=false,fistStart=0;
const osAct=a=>$('osAction').textContent=a;
function releaseMouse(send){if(mouseIsDown){if(send&&bridge.ready)bridge.raw({type:'mouseUp',button:'left'});mouseIsDown=false;osAct('released');}}
/** Release any held button, send kill (bridge pauses + releases), toggle off. reason=null → silent. */
function pauseOS(reason){releaseMouse(true);const was=osToggle.checked;osToggle.checked=false;
  if(bridge.connected)bridge.kill();pinch.reset();scrollY=null;if(reason){pauseReason=reason;if(was)log('OS control paused ('+reason+')');}osAct('paused');renderChip();}
function osControl(g,lm){
  const now=performance.now();
  // Open palm held 2 s → bridge kill/resume (works while paused or killed).
  if(g==='open_palm'){if(!palmStart){palmStart=now;palmFired=false;}const f=Math.min(1,(now-palmStart)/2000);$('palmProg').style.width=f*100+'%';
    if(f>=1&&!palmFired){palmFired=true;toggleKill();}}else{palmStart=0;$('palmProg').style.width='0';}
  // Fist held 1 s → pause.
  if(g==='fist'){releaseMouse(true);if(!fistStart)fistStart=now;else if(now-fistStart>1000&&(osToggle.checked||bridge.ready&&!bridge.killed))pauseOS('fist 1 s');}else fistStart=0;
  // Lost hand → release + pause.
  if(!lm){if(osToggle.checked||mouseIsDown)pauseOS('hand lost');scrollY=null;return;}
  const live=controlling();
  for(const e of pinchEv){
    if(e.type==='down'){const q=e.pos||curPos;clickRing();if(live&&g!=='fist'){bridge.move(q.x,q.y,true);bridge.mouseDown();mouseIsDown=true;osAct('press');}}
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
// ---------- Voice (Web Speech API; Chrome/Edge)
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;let rec=null,listening=false;
const VOICE=[[/\b(next|forward)\b/,()=>{goSlide(1);return 'next slide';}],[/\b(back|previous|prev)\b/,()=>{goSlide(-1);return 'previous slide';}],
 [/\bclear\b/,()=>{clearDraw();return 'clear canvas';}],[/\b(stop|pause|kill)\b/,()=>{pauseOS('voice');return 'pause OS control';}],
 [/\bdraw/,()=>{tab('draw');return 'Air Draw';}],[/\bmouse\b/,()=>{tab('cursor');return 'Air Mouse';}],[/\bslides?\b/,()=>{tab('slides');return 'Slides';}],
 [/\bsign\b/,()=>{tab('sign');return 'Sign';}],[/\btrain/,()=>{tab('train');return 'Train';}]];
function voiceCommand(text){const t=text.toLowerCase();$('voiceText').textContent='“'+text+'”';
  for(const [re,f] of VOICE)if(re.test(t)){const r=f();$('voiceCmd').textContent=r;log('Voice: '+r);return r;}$('voiceCmd').textContent='not a command';return null;}
$('voiceBtn').onclick=()=>{if(!SR){$('voiceCmd').textContent='Speech recognition is not available in this browser (use Chrome or Edge).';return;}
  if(listening){rec.stop();return;}
  rec=new SR();rec.lang='en-IN';rec.continuous=true;rec.interimResults=false;
  rec.onresult=e=>voiceCommand(e.results[e.results.length-1][0].transcript.trim());
  rec.onerror=e=>{$('voiceCmd').textContent='mic error: '+e.error;};
  rec.onend=()=>{listening=false;$('voiceBtn').textContent='● Start listening';$('voiceBtn').classList.remove('on');};
  rec.start();listening=true;$('voiceBtn').textContent='■ Stop listening';$('voiceBtn').classList.add('on');log('Voice: listening');};
// ---------- Test hook: replay synthetic landmarks without a camera
window.GestureOS={get armed(){return controlling();},get lever(){return osToggle.checked;},feed:(hands)=>processHands(hands||[]),setMode:m=>tab(m),voice:voiceCommand,bridge,get mode(){return mode;},get clicks(){return clicks;},get slide(){return si;},get typed(){return $('signText').textContent;},
  drawnPixels:()=>{const d=dctx.getImageData(0,0,dc.width,dc.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n;}};
// ---------- PWA
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').then(()=>log('Offline cache ready (service worker)')).catch(e=>console.warn('SW',e));
