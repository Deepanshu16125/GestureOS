// Synthetic 21-point MediaPipe-style hands built from joint angles (normalised image coords, y down).
// fingers: per index..pinky either a preset ('up','curl','half') or [mcpBend,pipBend,dipBend] in degrees.
// thumb: 'out' (to the side), 'in' (folded across the palm), 'up' (straight up, absolute), 'side' (beside the fist)
// rot: rotate the palm (deg, 0 = fingers point up); spread: fan the fingers (deg per finger).
const PRESET={up:[0,0,0],curl:[75,105,70],half:[45,60,40]};
export function hand({thumb='out',fingers=['up','up','up','up'],mirror=false,scale=1,cx=0.5,cy=0.8,rot=0,spread=4}={}){
  const P=[],rad=a=>a*Math.PI/180,s=scale,R=rad(rot);
  const loc=(x,y)=>{const X=x*Math.cos(R)-y*Math.sin(R),Y=x*Math.sin(R)+y*Math.cos(R);return {x:cx+(mirror?-X:X)*s,y:cy+Y*s,z:0};};
  const chain=(bx,by,dir,lens,bends,out,i0)=>{let x=bx,y=by,a=dir;out[i0]=[x,y];
    lens.forEach((L,j)=>{a+=bends[j];x+=L*Math.cos(rad(a));y+=L*Math.sin(rad(a));out[i0+j+1]=[x,y];});};
  const raw=[];raw[0]=[0,0];
  const baseX=[-0.065,-0.022,0.022,0.06],baseY=[-0.19,-0.2,-0.19,-0.17],lens=[[0.085,0.05,0.045],[0.09,0.055,0.045],[0.085,0.05,0.042],[0.065,0.04,0.035]];
  fingers.forEach((f,k)=>{const b=Array.isArray(f)?f:PRESET[f];
    // bends curl toward the palm (+ angle when the finger points up, i.e. toward +y side via clockwise)
    chain(baseX[k],baseY[k],-90+(k-1.5)*spread,lens[k],b.map(v=>(k<2?1:1)*v*1),raw,5+k*4);});
  const TH={out:[[-0.075,-0.08],[-0.12,-0.115],[-0.165,-0.15]],in:[[-0.07,-0.09],[-0.045,-0.125],[0.0,-0.13]],side:[[-0.075,-0.085],[-0.085,-0.125],[-0.09,-0.16]]};
  raw[1]=[-0.04,-0.04];
  if(thumb==='up'){const c=loc(-0.04,-0.04);P[1]=c;let y=c.y;[0.06,0.05,0.045].forEach((L,j)=>{y-=L*s;P[2+j]={x:c.x,y,z:0};});}
  else TH[thumb].forEach((q,j)=>raw[2+j]=q);
  for(let j=0;j<21;j++)if(raw[j]&&!P[j])P[j]=loc(...raw[j]);
  return P;
}
/** Move the thumb tip onto the index tip (pinch / O). */
export function touchThumb(P,gap=0.01){const h={...P[8]};const o=[...P];o[4]={x:h.x-gap,y:h.y+gap,z:0};
  o[3]={x:(o[4].x+P[2].x)/2-0.01,y:(o[4].y+P[2].y)/2,z:0};return o;}
export const POSES={
  open_palm:{thumb:'out',fingers:['up','up','up','up'],spread:6},
  fist:{thumb:'in',fingers:['curl','curl','curl','curl']},
  point:{thumb:'in',fingers:['up','curl','curl','curl']},
  point_droop:{thumb:'in',fingers:[[12,20,10],'curl','curl','curl']}, // index drooping ~20° at the PIP
  point_thumb_out:{thumb:'out',fingers:['up','curl','curl','curl']},
  peace:{thumb:'in',fingers:['up','up','curl','curl'],spread:9},
  thumbs_up:{thumb:'up',fingers:['curl','curl','curl','curl'],rot:90},
  pinch:{thumb:'out',fingers:[[25,30,15],'up','up','up'],touch:true},
};
export const LETTER_POSES={
  A:{thumb:'side',fingers:['curl','curl','curl','curl']},
  B:{thumb:'in',fingers:['up','up','up','up'],spread:1},
  D:{thumb:'in',fingers:['up','curl','curl','curl']},
  I:{thumb:'in',fingers:['curl','curl','curl','up']},
  L:{thumb:'out',fingers:['up','curl','curl','curl']},
  O:{thumb:'out',fingers:[[50,70,45],[50,70,45],[50,70,45],[50,70,45]],touch:true},
  V:{thumb:'in',fingers:['up','up','curl','curl'],spread:9},
  W:{thumb:'in',fingers:['up','up','up','curl'],spread:8},
  Y:{thumb:'out',fingers:['curl','curl','curl','up'],spread:10},
};
export const make=(pose,o={})=>{const h=hand({...pose,...o,rot:(pose.rot||0)+(o.rot||0)});return pose.touch?touchThumb(h):h;};
