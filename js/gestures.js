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
/** ASL letter templates [thumb,index,middle,ring,pinky]: 1 extended, 0 curled. O is scored separately. */
export const LETTERS={A:[0,0,0,0,0],B:[0,1,1,1,1],D:[0,1,0,0,0],I:[0,0,0,0,1],L:[1,1,0,0,0],V:[0,1,1,0,0],W:[0,1,1,1,0],Y:[1,0,0,0,1],' ':[1,1,1,1,1]};
const clamp01=x=>Math.max(0,Math.min(1,x));
/** Per-finger curl angle (deg) for k=1..4: bend at PIP + bend at DIP. 0 = straight, ~150+ = curled.
 *  Joint angles are relative to the finger itself, so it is rotation, scale and mirror invariant. */
export function curlAngle(lm,k){return (180-angle(lm[MCPS[k]],lm[PIPS[k]],lm[DIPS[k]]))+(180-angle(lm[PIPS[k]],lm[DIPS[k]],lm[TIPS[k]]));}
/** Continuous extension 0..1 per finger [thumb,index,middle,ring,pinky]. */
export function extension(lm){const hs=handSize(lm);
  const span=d2(lm[4],lm[17])/hs, far=d2(lm[4],lm[5])/hs, st=angle(lm[2],lm[3],lm[4]);
  const th=clamp01((span-0.8)/0.35)*clamp01((far-0.3)/0.3)*clamp01((st-110)/40);
  return [th,...[1,2,3,4].map(k=>{const c=curlAngle(lm,k),reach=d2(lm[TIPS[k]],lm[MCPS[k]])/hs;
    return Math.max(clamp01(1-(c-45)/100), clamp01((curlRatio(lm,k)-1.2)/0.5)*clamp01(1-(c-60)/120), clamp01((reach-0.3)/0.4)*0.6);})];}
const TOL=0.22, W=[0.7,1,1,1,1];
/** Score every letter 0..1 (tolerant per-finger match + shape checks), best first. */
export function signScores(lm){const e=extension(lm),hs=handSize(lm),out=[];
  for(const [L,t] of Object.entries(LETTERS)){let err=0,ws=0;t.forEach((x,j)=>{err+=W[j]*Math.max(0,Math.abs(x-e[j])-TOL)/(1-TOL);ws+=W[j];});
    let sc=1-err/ws*1.6;
    if(L==='V'&&d2(lm[8],lm[12])/hs<0.25)sc-=0.3;      // V: index and middle apart
    if(L==='B'&&d2(lm[8],lm[20])/hs>0.8)sc-=0.25;       // B: fingers together
    if(pinchRatio(lm)<0.25&&e[1]>0.25)sc-=0.35;                  // thumb tip on index tip = O
    out.push({letter:L,score:clamp01(sc)});}
  // O: thumb and index tips touch, other fingers rounded (neither straight nor fully fisted)
  const pr=pinchRatio(lm);out.push({letter:'O',score:clamp01((e[1]-0.1)/0.2)*clamp01(1-Math.max(0,pr-0.2)/0.25)*clamp01(1.5-e[1])*clamp01(1.4-Math.max(e[2],e[3],e[4]))});
  return out.sort((a,b)=>b.score-a.score);}
export const SIGN_ACCEPT=0.5, SIGN_MARGIN=0.1;
/** Sign reading: {letter (accepted or null), closest, conf, second, conf2}. */
export function signInfo(lm){const s=signScores(lm),[a,b]=s;const ok=a.score>=SIGN_ACCEPT&&a.score-b.score>=SIGN_MARGIN;
  return {letter:ok?a.letter:null,closest:a.letter,conf:a.score,second:b.letter,conf2:b.score};}
/** Rotation/scale-normalised landmarks for per-user sign calibration (k-NN): rotate so wrist→middle MCP points up. */
export function signFeatures(lm){const w=lm[0],hs=handSize(lm),ang=Math.atan2(lm[9].x-w.x,-(lm[9].y-w.y)),c=Math.cos(ang),sn=Math.sin(ang);
  const mir=((lm[5].x-w.x)*c+(lm[5].y-w.y)*sn)>((lm[17].x-w.x)*c+(lm[17].y-w.y)*sn)?-1:1;const f=[];
  for(const p of lm){const x=(p.x-w.x)/hs,y=(p.y-w.y)/hs;f.push(mir*(x*c+y*sn),-x*sn+y*c);}
  return f.concat(extension(lm).map(v=>v*2));}
/** Pen state for Air Draw, independent of hand orientation: index extended relative to its own MCP.
 *  down: curl < 70° and tip farther from MCP than PIP. Hysteresis: stays down until curl > 100° or tip folds back. */
export function indexPen(lm,wasDown=false){const c=curlAngle(lm,1),m=lm[5],far=d2(lm[8],m)>d2(lm[6],m)*(wasDown?1.05:1.3);
  return wasDown?(c<100&&far):(c<70&&far);}
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
