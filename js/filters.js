// One Euro filter (Casiez, Roussel, Vogel, CHI 2012) and pinch hysteresis state machine.
const alpha=(cutoff,dt)=>{const tau=1/(2*Math.PI*cutoff);return 1/(1+tau/dt);};
class LowPass{constructor(){this.y=null;}f(x,a){this.y=this.y===null?x:a*x+(1-a)*this.y;return this.y;}}
/** 1D One Euro filter. mincutoff (Hz): lower = less jitter when still. beta: higher = less lag when moving fast. */
export class OneEuro{
  constructor(mincutoff=1.0,beta=0.007,dcutoff=1.0){this.mincutoff=mincutoff;this.beta=beta;this.dcutoff=dcutoff;this.x=new LowPass();this.dx=new LowPass();this.t=null;}
  filter(v,tMs){
    const dt=this.t===null?1/60:Math.max(1e-3,(tMs-this.t)/1000);this.t=tMs;
    const prev=this.x.y, d=prev===null?0:(v-prev)/dt;
    const ed=this.dx.f(d,alpha(this.dcutoff,dt));
    const cutoff=this.mincutoff+this.beta*Math.abs(ed);
    return this.x.f(v,alpha(cutoff,dt));
  }
  reset(){this.x=new LowPass();this.dx=new LowPass();this.t=null;}
}
export class OneEuro2D{
  constructor(mincutoff=1.0,beta=0.007){this.fx=new OneEuro(mincutoff,beta);this.fy=new OneEuro(mincutoff,beta);}
  set(mincutoff,beta){for(const f of [this.fx,this.fy]){f.mincutoff=mincutoff;f.beta=beta;}}
  update(x,y,t=performance.now()){return {x:this.fx.filter(x,t),y:this.fy.filter(y,t)};}
  reset(){this.fx.reset();this.fy.reset();}
}
/** Map the inner `frac` of the camera frame to 0..1 (screen), mirroring x. */
export function mapInner(lmx,lmy,frac=0.7){const m=(1-frac)/2,c=v=>Math.min(1,Math.max(0,v));return {x:c((1-lmx-m)/frac),y:c((lmy-m)/frac)};}
/**
 * Pinch FSM with hysteresis on ratio = d(thumbTip,indexTip)/d(wrist,middleMCP).
 * Emits: 'down' on close (with the cursor position from ~lookbackMs earlier), 'drag' once held > dragMs, 'up' on open.
 */
export class PinchFSM{
  constructor({close=0.18,open=0.23,lookbackMs=200,dragMs=450}={}){Object.assign(this,{close,open,lookbackMs,dragMs});this.closed=false;this.dragging=false;this.t0=0;this.hist=[];this.ratio=null;this.downPos=null;}
  track(pos,t){this.hist.push({t,pos});while(this.hist.length&&t-this.hist[0].t>1000)this.hist.shift();}
  posAt(t){let best=this.hist[0]?.pos||null;for(const h of this.hist){if(h.t<=t)best=h.pos;else break;}return best;}
  update(ratio,t=performance.now()){
    this.ratio=ratio;const ev=[];
    if(ratio==null){if(this.closed){this.closed=false;this.dragging=false;ev.push({type:'up',lost:true});}return ev;}
    if(!this.closed&&ratio<this.close){this.closed=true;this.t0=t;this.downPos=this.posAt(t-this.lookbackMs);ev.push({type:'down',pos:this.downPos});}
    else if(this.closed&&ratio>this.open){this.closed=false;const held=t-this.t0,wasDrag=this.dragging;this.dragging=false;ev.push({type:'up',held,click:!wasDrag});}
    else if(this.closed&&!this.dragging&&t-this.t0>this.dragMs){this.dragging=true;ev.push({type:'drag'});}
    return ev;
  }
  reset(){this.closed=false;this.dragging=false;this.hist=[];}
}
