import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveDirections,trackingSign} from '../src/tracking.js';
const sample=()=>Array.from({length:33},(_,i)=>({x:0,y:0,z:0,visibility:0,presence:0}));
const set=(a,i,x,y,z=0)=>a[i]={x,y,z,visibility:1,presence:1};
test('one visible left arm never feeds right arm',()=>{
 const p=sample();set(p,11,.6,.4);set(p,13,.9,.7);set(p,15,.97,.5);
 const d=deriveDirections(p,.4);
 assert.deepEqual(d.LeftArm,[.30000000000000004,-.29999999999999993,0]);
 assert.ok(d.LeftForeArm);
 assert.equal(d.RightArm,undefined);
 assert.equal(d.RightForeArm,undefined);
});
test('two independent arms and legs map to their own sources, mirror display is never consulted',()=>{
 const p=sample();set(p,11,.6,.4);set(p,13,.8,.6);set(p,15,.9,.3);
 set(p,12,.4,.4);set(p,14,.3,.6);set(p,16,.2,.9);
 set(p,23,.55,.65);set(p,25,.6,.82);set(p,27,.57,.96);set(p,31,.60,1.02);
 set(p,24,.45,.65);set(p,26,.4,.81);set(p,28,.39,.95);set(p,32,.35,1.01);
 const d=deriveDirections(p,.4,trackingSign(p,.4));
 assert.ok(d.LeftArm&&d.RightArm&&d.LeftUpLeg&&d.RightUpLeg&&d.LeftLeg&&d.RightLeg&&d.LeftFoot&&d.RightFoot);
 assert.notDeepEqual(d.LeftArm,d.RightArm);
 assert.notDeepEqual(d.LeftLeg,d.RightLeg);
});
test('occluded knee holds own state: no copied motion',()=>{
 const p=sample();set(p,23,.6,.6);set(p,25,.63,.8);set(p,27,.66,.9);
 set(p,24,.4,.6);set(p,26,.41,.8);p[26].visibility=.1;
 const d=deriveDirections(p,.4);
 assert.ok(d.LeftUpLeg&&d.LeftLeg);assert.equal(d.RightUpLeg,undefined);assert.equal(d.RightLeg,undefined);
});
test('head uses ears/nose independently of limbs',()=>{
 const p=sample();set(p,7,.64,.19,0);set(p,8,.36,.20,0);set(p,0,.5,.18,-.13);
 const d=deriveDirections(p,.4);
 assert.ok(d.Head?.every(Number.isFinite));assert.equal(d.LeftArm,undefined);
});

test('default mannequin follows the same onscreen arm directions as the blue skeleton',async()=>{
 const {deriveMannequinScreenDirections}=await import('../src/tracking.js');
 const points=sample();
 set(points,11,.68,.33);set(points,12,.32,.33);
 set(points,13,.75,.70);set(points,15,.79,.89); // left arm DOWN
 set(points,14,.14,.27);set(points,16,.08,.20); // right arm UP/LEFT
 const screen=deriveMannequinScreenDirections(points,.4);
 assert.ok(screen.LeftArm[1]<0,'left arm must go down');
 assert.ok(screen.RightArm[1]>0,'right arm must go up');
 assert.ok(screen.LeftArm[0]>0,'left x follows camera image');
 assert.ok(screen.RightArm[0]<0,'right x follows camera image');
 assert.equal(screen.LeftArm[2],0);
 assert.equal(screen.RightArm[2],0);
});
test('default mannequin uses stable screen axes, never initial world-space handedness guess',async()=>{
 const {deriveMannequinScreenDirections}=await import('../src/tracking.js');
 const points=sample();
 set(points,11,.7,.3);set(points,12,.3,.3);
 set(points,13,.8,.12);set(points,15,.9,.08); // left arm raised
 set(points,14,.2,.66);set(points,16,.1,.9); // right arm lowered
 const got=deriveMannequinScreenDirections(points,.4);
 assert.ok(got.LeftArm[1]>0);
 assert.ok(got.RightArm[1]<0);
 const accidentalFlip=deriveDirections(points,.4,-1);
 assert.notEqual(got.LeftArm[0],accidentalFlip.LeftArm[0]);
});
test('cropped elbow cannot command screen-space forearm',async()=>{
 const {deriveMannequinScreenDirections}=await import('../src/tracking.js');
 const points=sample();
 set(points,11,.65,.3);set(points,13,.8,.5);
 set(points,15,1.20,.7); // gate sets an offscreen wrist to invisible
 points[15].visibility=0;
 const d=deriveMannequinScreenDirections(points,.4);
 assert.ok(d.LeftArm);
 assert.equal(d.LeftForeArm,undefined);
});
