// Synthetic 21-point MediaPipe-style hands (normalised image coords, y down) for unit tests.
// pose: {thumb:'out'|'in'|'pinch', fingers:[index,middle,ring,pinky] each 'up'|'curl'|'pinch'}
export function hand({thumb='out',fingers=['up','up','up','up'],mirror=false,scale=1,cx=0.5,cy=0.8}={}){
  const P=[],s=scale,pt=(x,y)=>({x:cx+(mirror?-x:x)*s,y:cy+y*s,z:0});
  P[0]=pt(0,0);
  const baseX=[-0.06,-0.02,0.02,0.06];
  // thumb
  if(thumb==='out'){P[1]=pt(-0.05,-0.04);P[2]=pt(-0.09,-0.08);P[3]=pt(-0.13,-0.11);P[4]=pt(-0.17,-0.14);}
  else if(thumb==='in'){P[1]=pt(-0.05,-0.04);P[2]=pt(-0.07,-0.08);P[3]=pt(-0.05,-0.11);P[4]=pt(-0.02,-0.12);}
  else {P[1]=pt(-0.05,-0.04);P[2]=pt(-0.08,-0.09);P[3]=pt(-0.09,-0.15);P[4]=pt(-0.075,-0.2);} // pinch: tip meets index tip
  fingers.forEach((f,k)=>{const i=5+k*4,x=baseX[k];
    P[i]=pt(x,-0.2);
    if(f==='up'){P[i+1]=pt(x,-0.28);P[i+2]=pt(x,-0.33);P[i+3]=pt(x,-0.38);}
    else if(f==='curl'){P[i+1]=pt(x,-0.26);P[i+2]=pt(x,-0.2);P[i+3]=pt(x,-0.15);}
    else {P[i+1]=pt(x-0.005,-0.27);P[i+2]=pt(x-0.01,-0.24);P[i+3]=pt(x-0.015,-0.205);} // index bent toward thumb
  });
  return P;
}
export const POSES={
  open_palm:{thumb:'out',fingers:['up','up','up','up']},
  fist:{thumb:'in',fingers:['curl','curl','curl','curl']},
  point:{thumb:'in',fingers:['up','curl','curl','curl']},
  pinch:{thumb:'pinch',fingers:['pinch','up','up','up']},
};
