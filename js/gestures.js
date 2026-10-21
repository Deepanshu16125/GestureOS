// Landmark feature extraction, rule-based classifier, temporal smoothing.
const d=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
export const TIPS=[4,8,12,16,20], PIPS=[3,6,10,14,18];
/** Normalized feature vector: wrist-relative, scale-invariant (63 coords + 10 pairwise tip distances). */
export function features(lm){
  const w=lm[0], s=d(lm[0],lm[9])||1e-6, f=[];
  for(const p of lm){f.push((p.x-w.x)/s,(p.y-w.y)/s,((p.z||0)-(w.z||0))/s);}
  for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)f.push(d(lm[TIPS[i]],lm[TIPS[j]])/s);
  return f;
}
/** Which fingers are extended [thumb,index,middle,ring,pinky]. */
export function fingerStates(lm){
  const w=lm[0], up=[];
  up.push(d(lm[4],lm[17])>d(lm[3],lm[17])*1.1 && d(lm[4],lm[5])>d(lm[0],lm[5])*0.45);
  for(let i=1;i<5;i++) up.push(d(lm[TIPS[i]],w)>d(lm[PIPS[i]],w)*1.12);
  return up;
}
const d2=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y); // 2D: MediaPipe z is on a different scale and inflated pinch distances
/** Hand size: the larger of wrist→middle-MCP and palm width (index MCP→pinky MCP), so it survives tilt. */
export const handSize=lm=>Math.max(d2(lm[0],lm[9]),d2(lm[5],lm[17]))||1e-6;
/** Thumb-tip(4)→index-tip(8) distance / hand size. Invariant to mirroring and left/right hand. */
export const pinchRatio=lm=>d2(lm[4],lm[8])/handSize(lm);
export const PINCH_ENTER=0.35, PINCH_EXIT=0.5;
/** A finger is curled when its tip is closer to the wrist than its PIP joint. Index order: 1=index..4=pinky. */
export const curled=(lm,i)=>d2(lm[TIPS[i]],lm[0])<d2(lm[PIPS[i]],lm[0]);
/** pinchClosed: hysteresis state from PinchFSM; without it a fixed enter threshold is used. */
export function classify(lm,pinchClosed=null){
  const u=fingerStates(lm), pinch=pinchRatio(lm);
  const [t,i,m,r,p]=u, n=u.filter(Boolean).length;
  const c=[1,2,3,4].map(k=>curled(lm,k)), allCurled=c.every(Boolean), mrpCurled=c[1]&&c[2]&&c[3];
  // 1) pinch first: thumb and index tips together, but the other three fingers are not all curled (that is a fist).
  if((pinchClosed??pinch<PINCH_ENTER) && !mrpCurled) return {name:'pinch',conf:Math.max(.5,Math.min(1,1-pinch))};
  // 2) fist: every fingertip curled past its PIP.
  if(allCurled) return {name:'fist',conf:.9};
  if(n===5||(i&&m&&r&&p)) return {name:'open_palm',conf:.9};
  if(t&&!i&&!m&&!r&&!p) return {name: lm[4].y<lm[2].y?'thumbs_up':'thumbs_down',conf:.85};
  if(i&&m&&!r&&!p) return {name:'peace',conf:.85};
  if(i&&!m&&!r&&!p) return {name:'point',conf:.85};
  if(n===0) return {name:'fist',conf:.8};
  if(i&&p&&!m&&!r) return {name:'rock',conf:.75};
  return {name:'unknown',conf:.3};
}
/** ASL letter subset from finger states + geometry. */
export function signLetter(lm){
  const s=d(lm[0],lm[9])||1e-6,[t,i,m,r,p]=fingerStates(lm);
  if(d(lm[4],lm[8])/s<0.3 && d(lm[4],lm[12])/s<0.45 && !r && !p) return 'O';
  if(!i&&!m&&!r&&!p) return t?'A':null;
  if(i&&m&&r&&p&&!t) return 'B';
  if(i&&m&&r&&p&&t) return ' ';
  if(t&&i&&!m&&!r&&!p) return 'L';
  if(!t&&i&&!m&&!r&&!p) return 'D';
  if(i&&m&&!r&&!p) return 'V';
  if(i&&m&&r&&!p) return 'W';
  if(t&&!i&&!m&&!r&&p) return 'Y';
  if(!t&&!i&&!m&&!r&&p) return 'I';
  return null;
}
/** Majority-vote smoother over a sliding window + EMA point filter. */
export class Smoother{
  constructor(n=7){this.n=n;this.buf=[];}
  push(label){this.buf.push(label);if(this.buf.length>this.n)this.buf.shift();
    const c={};for(const l of this.buf)c[l]=(c[l]||0)+1;
    let best=label,bc=0;for(const k in c)if(c[k]>bc){bc=c[k];best=k;}
    return {label:best,ratio:bc/this.buf.length};}
}
export class EMA{constructor(a=.35){this.a=a;this.v=null;}
  update(x,y){if(!this.v)this.v={x,y};else{this.v.x+=this.a*(x-this.v.x);this.v.y+=this.a*(y-this.v.y);}return this.v;}}
