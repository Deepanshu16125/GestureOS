import {HandLandmarker,FilesetResolver} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import {features,classify,signLetter,Smoother,EMA} from './gestures.js';
import {KNN} from './knn.js';
const $=id=>document.getElementById(id);
const video=$('video'),ov=$('overlay'),octx=ov.getContext('2d');
let landmarker=null,mode='cursor',running=false,lastVideoTime=-1;
const smoother=new Smoother(7),cur=new EMA(.35),knn=new KNN();
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
    await video.play();running=true;$('camMsg').style.display='none';$('startBtn').textContent='● Live';log('Camera + model ready');requestAnimationFrame(loop);
  }catch(e){$('camMsg').textContent='Error: '+e.message+' (needs webcam, internet for first model load, and http://localhost)';}
};
// Perf
let frames=0,fpsT=performance.now(),fpsHist=[];
function perf(lat){frames++;const n=performance.now();$('lat').textContent=lat.toFixed(1)+' ms';
  if(n-fpsT>=500){const f=frames*1000/(n-fpsT);frames=0;fpsT=n;$('fps').textContent=f.toFixed(0);fpsHist.push(f);if(fpsHist.length>52)fpsHist.shift();drawChart();}}
function drawChart(){const c=$('fpsChart'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.strokeStyle='#00e5ff';x.lineWidth=2;x.beginPath();
  fpsHist.forEach((f,i)=>{const px=i*5,py=c.height-Math.min(f,60)/60*c.height;i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();}
const CONN=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawHand(lm){const W=ov.width,H=ov.height;octx.strokeStyle='#00e5ff';octx.lineWidth=3;
  for(const [a,b] of CONN){octx.beginPath();octx.moveTo(lm[a].x*W,lm[a].y*H);octx.lineTo(lm[b].x*W,lm[b].y*H);octx.stroke();}
  octx.fillStyle='#7c4dff';for(const p of lm){octx.beginPath();octx.arc(p.x*W,p.y*H,4,0,7);octx.fill();}}
let prevG='none';
function loop(){
  if(!running)return;
  if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;
    ov.width=video.videoWidth;ov.height=video.videoHeight;
    const t0=performance.now(),res=landmarker.detectForVideo(video,t0),lat=performance.now()-t0;perf(lat);
    octx.clearRect(0,0,ov.width,ov.height);const hands=res.landmarks||[];$('hands').textContent=hands.length;
    let g='none',conf=0,lm=null;
    if(hands.length){hands.forEach(drawHand);lm=hands[0];const r=classify(lm);g=r.name;conf=r.conf;
      const vec=features(lm);
      if(Object.keys(knn.classes()).length){const p=knn.predict(vec,+$('kVal').value||5);
        if(p){$('knnPred').textContent=p.label;$('knnConf').textContent='('+(p.conf*100).toFixed(0)+'%)';
          if($('useCustom').checked&&p.conf>.8&&p.dist<1.2){g=p.label;conf=p.conf;}}}
      if(recording)record(vec);}
    $('raw').textContent=g;const sm=smoother.push(g);$('conf').textContent=(conf*sm.ratio*100).toFixed(0)+'%';
    $('gestureBadge').textContent=EMO[sm.label]||('⭐ '+sm.label);
    if(sm.label!==prevG){if(sm.label!=='none')log('Gesture: '+sm.label);prevG=sm.label;}
    handleMode(sm.label,lm);
  }
  requestAnimationFrame(loop);
}
// ---------- Air Mouse
const pad=$('pad'),vc=$('vcursor');let clicks=0,wasPinch=false;
function airMouse(g,lm){if(!lm)return;const r=pad.getBoundingClientRect();
  const nx=Math.min(1,Math.max(0,(1-lm[8].x-.15)/.7)),ny=Math.min(1,Math.max(0,(lm[8].y-.15)/.7));
  const p=cur.update(nx*r.width,ny*r.height);vc.style.left=p.x+'px';vc.style.top=p.y+'px';
  const pin=g==='pinch';vc.classList.toggle('down',pin);let hovered=null;
  pad.querySelectorAll('.target').forEach(t=>{const b=t.getBoundingClientRect(),x=r.left+p.x,y=r.top+p.y;
    const h=x>b.left&&x<b.right&&y>b.top&&y<b.bottom;t.classList.toggle('hover',h);if(h)hovered=t;});
  if(pin&&!wasPinch&&hovered){clicks++;$('clickCount').textContent=clicks;hovered.classList.add('hit');setTimeout(()=>hovered.classList.remove('hit'),300);log('Click on '+hovered.textContent);}
  wasPinch=pin;}
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
const SLIDES=[['GestureOS','#3d5afe'],['On-device ML — privacy first','#7c4dff'],['21 landmarks · 30+ FPS','#00897b'],['Custom gestures via k-NN','#c2185b'],['Thank you! 🙏','#f57c00']];
let si=0,playing=false,muted=false,prog=0,hist=[],cool=0;
function showSlide(){$('slide').textContent=SLIDES[si][0];$('slide').style.background=SLIDES[si][1];}showSlide();
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
function renderClasses(){const ul=$('classList');ul.innerHTML='';for(const [l,c] of Object.entries(knn.classes())){const li=document.createElement('li');li.innerHTML=`<b>${l}</b> — ${c} samples `;
  const b=document.createElement('button');b.textContent='✕';b.onclick=()=>{knn.removeClass(l);renderClasses();};li.append(b);ul.append(li);}}
renderClasses();
$('resetBtn').onclick=()=>{if(confirm('Delete all custom gestures?')){knn.reset();renderClasses();}};
$('exportBtn').onclick=()=>{const a=document.createElement('a');a.download='gestureos-model.json';a.href=URL.createObjectURL(new Blob([knn.export()]));a.click();};
$('importFile').onchange=async e=>{try{knn.import(await e.target.files[0].text());renderClasses();log('Model imported');}catch(err){alert(err.message);}};
function handleMode(g,lm){if(mode==='cursor')airMouse(g,lm);else if(mode==='draw')airDraw(g,lm);else if(mode==='slides')slides(g,lm);else if(mode==='sign')sign(lm);}
