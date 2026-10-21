import test from 'node:test';import assert from 'node:assert/strict';
import {classify,pinchRatio,signInfo,PINCH_ENTER,PINCH_EXIT,fingerState} from '../js/gestures.js';
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
  const r=signInfo(hand({thumb:'in',fingers:['up','half','curl','curl']}));assert.equal(r.letter,null);assert.ok(r.closest);assert.ok(r.conf<0.8);});
test('PinchFSM hysteresis: enter <0.35, stays closed at 0.42, exits >0.5',()=>{
  const f=new PinchFSM();assert.equal(f.update(0.3,0)[0].type,'down');assert.equal(f.update(0.42,10).length,0);assert.ok(f.closed);
  const up=f.update(0.55,100);assert.equal(up[0].type,'up');assert.equal(up[0].click,true);assert.equal(new PinchFSM().update(0.4,0).length,0);});
