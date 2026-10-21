import test from 'node:test';import assert from 'node:assert/strict';
import {indexPen,signScores,signFeatures,classify,pinchRatio,signInfo,PINCH_ENTER,PINCH_EXIT,fingerState} from '../js/gestures.js';
import {PinchFSM} from '../js/filters.js';
import {make,hand,POSES,LETTER_POSES} from './hands.mjs';
const V=[{},{mirror:true},{scale:0.6},{scale:1.5},{rot:12},{rot:-12,mirror:true}];
const expect={open_palm:'open_palm',fist:'fist',point:'point',point_droop:'point',point_thumb_out:'point',peace:'peace',thumbs_up:'thumbs_up',pinch:'pinch'};
for(const [pose,want] of Object.entries(expect))for(const v of V)
  test(`${pose} ${JSON.stringify(v)} → ${want}`,()=>assert.equal(classify(make(POSES[pose],v)).name,want));
test('point with the index drooping 20° (and 30°) stays point, not fist',()=>{
  for(const b of [[0,20,0],[10,20,10],[15,30,10]])assert.equal(classify(hand({thumb:'in',fingers:[b,'curl','curl','curl']})).name,'point',JSON.stringify(b));});
test('fist needs all four curled; hysteresis keeps fist while the index is only half open',()=>{
  const half=hand({thumb:'in',fingers:['half','curl','curl','curl']});
  assert.equal(fingerState(half,1),'mid');assert.notEqual(classify(half).name,'fist');assert.equal(classify(half,null,'fist').name,'fist');});
test('thumbs up is not swallowed by fist or pinch, even with the pinch FSM closed',()=>{
  assert.equal(classify(make(POSES.thumbs_up),false,'fist').name,'thumbs_up');});
test('peace needs the two fingers apart',()=>{assert.notEqual(classify(hand({thumb:'in',fingers:['up','up','curl','curl'],spread:0})).name,'peace');});
test('fist is never pinch even when the FSM is closed',()=>assert.equal(classify(make(POSES.fist),true).name,'fist'));
test('pinch ratio: pinch below enter, open palm above exit',()=>{assert.ok(pinchRatio(make(POSES.pinch))<PINCH_ENTER);assert.ok(pinchRatio(make(POSES.open_palm))>PINCH_EXIT);});
for(const [L,pose] of Object.entries(LETTER_POSES))for(const v of [{},{mirror:true},{scale:1.4}])
  test(`sign ${L} ${JSON.stringify(v)}`,()=>{const r=signInfo(make(pose,v));assert.equal(r.letter,L);assert.ok(r.conf>=0.8);});
test('sign: an ambiguous half-open hand gives no letter but still reports the closest one',()=>{
  const r=signInfo(hand({thumb:'in',fingers:['up','half','curl','curl']}));assert.equal(r.letter,null);assert.ok(r.closest);assert.ok(r.second);});
test('PinchFSM hysteresis: enter <0.35, stays closed at 0.42, exits >0.5',()=>{
  const f=new PinchFSM();assert.equal(f.update(0.3,0)[0].type,'down');assert.equal(f.update(0.42,10).length,0);assert.ok(f.closed);
  const up=f.update(0.55,100);assert.equal(up[0].type,'up');assert.equal(up[0].click,true);assert.equal(new PinchFSM().update(0.4,0).length,0);});
import {thumbsUpScore,fingerDebug,Smoother} from '../js/gestures.js';
for(const rot of [0,45,90,135,180,-90])for(const mirror of [false,true])
  test(`thumbs up in any orientation: rot ${rot} mirror ${mirror}`,()=>assert.equal(classify(hand({thumb:'out',fingers:['curl','curl','curl','curl'],rot,mirror})).name,'thumbs_up'));
test('closing hand / fist / A-shape is never thumbs up',()=>{
  for(const fingers of [['curl','curl','curl','curl'],['half','half','half','half'],['half','curl','curl','curl']])for(const thumb of ['in','side'])
    assert.notEqual(classify(hand({thumb,fingers})).name,'thumbs_up',thumb+JSON.stringify(fingers));});
test('finger debug string',()=>{assert.equal(fingerDebug(make(POSES.point)),'T- I+ M- R- P-');assert.match(fingerDebug(hand({thumb:'out',fingers:['curl','curl','curl','curl']})),/^T\+ I- M- R- P-$/);});
test('Smoother votes over time, not frames (5 fps)',()=>{const s=new Smoother(250);s.push('fist',0);s.push('point',200);const r=s.push('point',400);assert.equal(r.label,'point');});

// v9: rotated / mirrored / scaled signs, accept threshold with margin
for(const [L,pose] of Object.entries(LETTER_POSES))for(const v of [{rot:30},{rot:-35,mirror:true},{rot:60},{rot:90,scale:0.7},{rot:-60,scale:1.5}])
  test(`sign ${L} rotated ${JSON.stringify(v)}`,()=>{const r=signInfo(make(pose,v));assert.equal(r.letter,L);assert.ok(r.conf>=0.7,String(r.conf));assert.ok(r.conf-r.conf2>=0.1);});
test('sign scores are sorted and cover all letters + O',()=>{const s=signScores(make(LETTER_POSES.V));assert.equal(s.length,10);for(let i=1;i<s.length;i++)assert.ok(s[i-1].score>=s[i].score);});
test('signFeatures are rotation and scale invariant',()=>{const a=signFeatures(make(LETTER_POSES.W)),b=signFeatures(make(LETTER_POSES.W,{rot:50,scale:1.3}));
  assert.ok(a.reduce((t,x,i)=>t+Math.abs(x-b[i]),0)<1e-6*a.length+1e-3);});
// v9: Air Draw pen does not need the index pointing up
for(const t of [0,10,20,30,40,50,60])for(const rot of [0,45,90,150,-60])
  test(`pen down: index tilted ${t}° down, hand rot ${rot}`,()=>{assert.ok(indexPen(hand({thumb:'in',fingers:[[t,t*0.25,t*0.1],'curl','curl','curl'],rot})));
    assert.ok(indexPen(hand({thumb:'out',fingers:[[t,0,0],'half','curl','curl'],rot,mirror:true}),true));});
test('pen up: curled index / fist, with and without hysteresis',()=>{for(const w of [false,true]){assert.equal(indexPen(make(POSES.fist),w),false);
  assert.equal(indexPen(hand({thumb:'in',fingers:[[40,90,60],'curl','curl','curl']}),w),false);}});
test('pen hysteresis: a half-bent index (~85° curl) keeps an existing stroke but does not start one',()=>{const h=hand({thumb:'in',fingers:[[20,55,30],'curl','curl','curl']});
  assert.equal(indexPen(h,false),false);assert.equal(indexPen(h,true),true);});
