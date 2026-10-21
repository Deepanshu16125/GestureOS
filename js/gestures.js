// Landmark feature extraction, rule-based classifier, temporal smoothing.
const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
/** Normalized feature vector: wrist-relative, scale-invariant (63 coords + 10 pairwise tip distances). */
export function features(lm){
  const w=lm[0], s=d(lm[0],lm[9])||1e-6, f=[];
  for(const p of lm){f.push((p.x-w.x)/s,(p.y-w.y)/s,((p.z||0)-(w.z||0))/s);}
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)f.push(d(lm[TIPS[i]],lm[TIPS[j]])/s);
  return f;
}
const d2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y); // 2D: MediaPipe z is on a different scale
/** Angle at b (degrees) between b→a and b→c. 180 = straight. */
export function angle(a,b,c){const ux=a.x-b.x,uy=a.y-b.y,vx=c.x-b.x,vy=c.y-b.y;
  const n=Math.hypot(ux,uy)*Math.hypot(vx,vy)||1e-9;return Math.acos(Math.max(-1,Math.min(1,(ux*vx+uy*vy)/n)))*180/Math.PI;}
/** Hand size: the larger of wrist→middle-MCP and palm width (index MCP→pinky MCP), so it survives tilt. */
export const handSize=lm=>Math.max(d2(lm[0],lm[9]),d2(lm[5],lm[17]))||1e-6;
export const TIPS=[4,8,12,16,20], PIPS=[3,6,10,14,18], MCPS=[2,5,9,13,17], DIPS=[3,7,11,15,19];
/**
 * Finger state for index..pinky (k=1..4): 'ext' | 'mid' | 'curl'.
 * Uses the bend at the PIP (MCP-PIP-DIP angle) plus the tip's reach from its MCP / hand size,
 * so a slightly drooping index still counts as extended. Index is judged more leniently.
 */
export function fingerState(lm,k){
  const m=lm[MCPS[k]],p=lm[PIPS[k]],dd=lm[DIPS[k]],t=lm[TIPS[k]],hs=handSize(lm);
  const bend=angle(m,p,dd), bend2=angle(p,dd,t), reach=d2(t,m)/hs;
  const extA=k===1?135:150, extR=k===1?0.6:0.68;
  if((bend>extA&&reach>extR*0.85)||(reach>extR*1.1&&bend>125&&bend2>120))return 'ext';
  if(bend<100||reach<0.42)return 'curl';
  return 'mid';
}
/** Thumb: extended when the tip is far from the pinky MCP (folded thumbs lie across the palm toward it),
 *  clear of the index MCP, and the thumb is fairly straight. up = tip clearly above its MCP in image coords. */
export function thumbState(lm){const hs=handSize(lm),far=d2(lm[4],lm[5])/hs,span=d2(lm[4],lm[17])/hs,straight=angle(lm[2],lm[3],lm[4]);
  const dy=lm[2].y-lm[4].y;
  return {ext:span>0.9&&far>0.4&&straight>140,far,span,straight,up:dy/hs>0.35&&Math.abs(dy)>Math.abs(lm[4].x-lm[2].x)*1.2};}
/** Which fingers are extended [thumb,index,middle,ring,pinky] (booleans, kept for features/compat). */
export function fingerStates(lm){return [thumbState(lm).ext,...[1,2,3,4].map(k=>fingerState(lm,k)==='ext')];}
/** Thumb-tip(4)→index-tip(8) distance / hand size. Invariant to mirroring and left/right hand. */
export const pinchRatio=lm=>d2(lm[4],lm[8])/handSize(lm);
export const PINCH_ENTER=0.35, PINCH_EXIT=0.5;
/** Kept for compatibility: tip closer to the wrist than its PIP. */
export const curled=(lm,i)=>d2(lm[TIPS[i]],lm[0])<d2(lm[PIPS[i]],lm[0]);
/**
 * Rule-based classifier. Order: thumbs up → pinch → fist → open palm → peace → point → rock.
 * pinchClosed: hysteresis state from PinchFSM. prev: last raw label (fist hysteresis:
 * entering fist needs all four fingers 'curl'; staying needs none of them 'ext').
 */
/** Orientation-independent curl: tip-to-wrist / MCP-to-wrist. Curled fingers fold back toward the wrist (< ~1.25). */
export const curlRatio=(lm,k)=>d2(lm[TIPS[k]],lm[0])/(d2(lm[MCPS[k]],lm[0])||1e-6);
/** Thumbs up in ANY orientation: thumb straight-ish and far from the palm centre (middle MCP 9),
 *  tip farther from the wrist than its IP joint; the other four folded (curl ratio or angle state). */
export function thumbsUpScore(lm){const hs=handSize(lm);
  const fold=[1,2,3,4].every(k=>curlRatio(lm,k)<1.25||fingerState(lm,k)==='curl');
  const away=d2(lm[4],lm[9])/hs, straight=angle(lm[2],lm[3],lm[4]), outward=d2(lm[4],lm[0])>d2(lm[3],lm[0]);
  return {ok:fold&&away>0.65&&straight>130&&outward&&pinchRatio(lm)>0.5,away,straight,fold};}
/** Debug: compact finger-state string, e.g. "T+ I+ M- R- P-" (+ extended, ~ half, - curled). */
export function fingerDebug(lm){const c={ext:'+',mid:'~',curl:'-'};const t=thumbsUpScore(lm);
  return `T${thumbState(lm).ext||t.away>0.65?'+':'-'} `+['I','M','R','P'].map((n,j)=>n+c[fingerState(lm,j+1)]).join(' ');}
export function classify(lm,pinchClosed=null,prev=null){
  const f=[1,2,3,4].map(k=>fingerState(lm,k)), th=thumbState(lm), pinch=pinchRatio(lm), hs=handSize(lm);
  const [i,m,r,p]=f, ext=x=>x==='ext', notExt=x=>x!=='ext', curl=x=>x==='curl';
  const fourCurl=f.every(curl), fourNotExt=f.every(notExt);
  if(thumbsUpScore(lm).ok) return {name:'thumbs_up',conf:.9};
  if((pinchClosed??pinch<PINCH_ENTER) && !(curl(m)&&curl(r)&&curl(p))) return {name:'pinch',conf:Math.max(.5,Math.min(1,1-pinch))};
  if(fourCurl||(prev==='fist'&&fourNotExt)) return {name:'fist',conf:.9};
  if(f.every(ext)) return {name:'open_palm',conf:.9};
  if(ext(i)&&ext(m)&&notExt(r)&&notExt(p)) return d2(lm[8],lm[12])/hs>0.3?{name:'peace',conf:.85}:{name:'unknown',conf:.4};
  if(ext(i)&&notExt(m)&&notExt(r)&&notExt(p)) return {name:'point',conf:.85};
  if(ext(i)&&ext(p)&&notExt(m)&&notExt(r)) return {name:'rock',conf:.75};
  return {name:'unknown',conf:.3};
}
/** ASL letter templates [thumb,index,middle,ring,pinky]: 1 extended, 0 curled. O is checked separately. */
export const LETTERS={A:[0,0,0,0,0],B:[0,1,1,1,1],D:[0,1,0,0,0],I:[0,0,0,0,1],L:[1,1,0,0,0],V:[0,1,1,0,0],W:[0,1,1,1,0],Y:[1,0,0,0,1],' ':[1,1,1,1,1]};
/** Sign reading: {letter (accepted or null), closest, conf 0..1}. */
export function signInfo(lm){
  const hs=handSize(lm),th=thumbState(lm),f=[1,2,3,4].map(k=>fingerState(lm,k));
  const v=[th.ext?1:0,...f.map(s=>s==='ext'?1:s==='mid'?0.5:0)];
  // O: thumb and index tips touch, other fingers rounded (not extended)
  if(pinchRatio(lm)<0.3&&f.slice(1).every(s=>s!=='ext')&&f[0]!=='ext')return {letter:'O',closest:'O',conf:.85};
  let best=null,bd=9;for(const [L,t] of Object.entries(LETTERS)){const dist=t.reduce((s,x,j)=>s+Math.abs(x-v[j]),0);if(dist<bd){bd=dist;best=L;}}
  let conf=Math.max(0,1-bd/2.5);
  let ok=bd===0;
  if(best==='V'&&d2(lm[8],lm[12])/hs<0.3)ok=false;          // V needs the two fingers apart
  if(best==='B'&&d2(lm[8],lm[20])/hs>0.75)ok=false;         // B: fingers together
  if(best==='A'&&th.span>0.9)ok=false;                       // A: thumb rests beside the fist
  if(!ok)conf=Math.min(conf,.6);
  return {letter:ok?best:null,closest:best,conf};
}
export function signLetter(lm){return signInfo(lm).letter;}
/** Majority-vote smoother over a sliding window + EMA point filter. */
export class Smoother{
  /** Time-based majority vote over the last `ms` milliseconds (frame-rate independent; always keeps ≥2 samples). */
  constructor(ms=250){this.ms=ms;this.buf=[];}
  push(label,t=(typeof performance!=='undefined'?performance.now():Date.now())){this.buf.push({label,t});
    while(this.buf.length>2&&t-this.buf[0].t>this.ms)this.buf.shift();
    const labels=this.buf.map(b=>b.label);
    const c={};for(const l of labels)c[l]=(c[l]||0)+1;
    let best=label,bc=0;for(const k in c)if(c[k]>bc){bc=c[k];best=k;}
    return {label:best,ratio:bc/this.buf.length};}
}
export class EMA{constructor(a=.35){this.a=a;this.v=null;}
  update(x,y){if(!this.v)this.v={x,y};else{this.v.x+=this.a*(x-this.v.x);this.v.y+=this.a*(y-this.v.y);}return this.v;}}
