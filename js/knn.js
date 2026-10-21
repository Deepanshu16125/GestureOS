// Tiny k-NN classifier persisted in localStorage.
const KEY='gestureos_knn_v1';
export class KNN{
  constructor(){this.data=[];this.load();}
  load(){try{this.data=JSON.parse(localStorage.getItem(KEY))||[];}catch{this.data=[];}}
  save(){localStorage.setItem(KEY,JSON.stringify(this.data));}
  add(label,vec){this.data.push({l:label,v:vec.map(x=>+x.toFixed(4))});}
  classes(){const c={};for(const s of this.data)c[s.l]=(c[s.l]||0)+1;return c;}
  removeClass(l){this.data=this.data.filter(s=>s.l!==l);this.save();}
  reset(){this.data=[];this.save();}
  predict(vec,k=5){
    if(this.data.length<k) return null;
    const ds=this.data.map(s=>{let t=0;for(let i=0;i<vec.length;i++){const e=vec[i]-s.v[i];t+=e*e;}return [Math.sqrt(t),s.l];});
    ds.sort((a,b)=>a[0]-b[0]);const top=ds.slice(0,k),votes={};
    for(const [dist,l] of top) votes[l]=(votes[l]||0)+1/(dist+1e-3);
    let best=null,bv=0,sum=0;for(const l in votes){sum+=votes[l];if(votes[l]>bv){bv=votes[l];best=l;}}
    return {label:best,conf:bv/sum,dist:top[0][0]};
  }
  export(){return JSON.stringify(this.data);}
  import(json){const d=JSON.parse(json);if(!Array.isArray(d))throw Error('bad file');this.data=d;this.save();}
}
