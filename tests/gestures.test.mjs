import test from 'node:test';import assert from 'node:assert/strict';
import {classify,pinchRatio,PINCH_ENTER,PINCH_EXIT} from '../js/gestures.js';
import {PinchFSM} from '../js/filters.js';
import {hand,POSES} from './hands.mjs';
for(const [name,pose] of Object.entries(POSES))for(const mirror of [false,true])for(const scale of [0.6,1,1.5])
  test(`${name} mirror=${mirror} scale=${scale}`,()=>assert.equal(classify(hand({...pose,mirror,scale})).name,name));
test('pinch ratio is below enter, open palm above exit',()=>{
  assert.ok(pinchRatio(hand(POSES.pinch))<PINCH_ENTER);assert.ok(pinchRatio(hand(POSES.open_palm))>PINCH_EXIT);});
test('fist is never reported as pinch, even when the FSM is closed',()=>assert.equal(classify(hand(POSES.fist),true).name,'fist'));
test('PinchFSM hysteresis: enter <0.35, stays closed at 0.42, exits >0.5',()=>{
  const f=new PinchFSM();assert.equal(f.update(0.3,0)[0].type,'down');assert.equal(f.update(0.42,10).length,0);assert.ok(f.closed);
  const up=f.update(0.55,100);assert.equal(up[0].type,'up');assert.equal(up[0].click,true);
  assert.equal(new PinchFSM().update(0.4,0).length,0);});
