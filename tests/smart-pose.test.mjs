import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmartPoseTracker,resetSmartPoseTracker,stabilizePoseLandmarks,reconstructMiddle}
 from '../src/smart-pose.js';
import {deriveDirections} from '../src/tracking.js';

const points=()=>Array.from({length:33},()=>({
 x:0,y:0,z:0,visibility:0,presence:0
}));
const set=(p,i,x,y,z=0,visible=true)=>{
 p[i]={x,y,z,visibility:visible?1:0,presence:visible?1:0};
};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('recovers occluded elbow from previous anatomical bend plane',()=>{
 const tracker=createSmartPoseTracker(),p=points();
 set(p,11,0,0);set(p,13,1,.7);set(p,15,2,0);
 stabilizePoseLandmarks(tracker,p,1000);
 const lengths=tracker.chains.get('left-arm').lengths;
 set(p,13,0,0,0,false);set(p,15,1.8,.2);
 const got=stabilizePoseLandmarks(tracker,p,1080,.4);
 assert.equal(got.recovered,1);
 const elbow=got.landmarks[13];
 assert.ok(elbow.inferred);
 assert.ok(elbow.y>.35);
 assert.ok(Math.abs(distance(elbow,p[11])-lengths[0])<1e-5);
 assert.ok(Math.abs(distance(elbow,p[15])-lengths[1])<1e-5);
 const d=deriveDirections(got.landmarks,.4,1);
 assert.ok(d.LeftArm && d.LeftForeArm);
 assert.equal(d.RightArm,undefined);
 assert.equal(p[13].visibility,0,'source MediaPipe data must not be mutated');
});
test('different arms keep independent elbow reference and bend direction',()=>{
 const tracker=createSmartPoseTracker(),p=points();
 set(p,11,0,0);set(p,13,1,.5);set(p,15,2,0);
 set(p,12,0,0);set(p,14,-1,-.5);set(p,16,-2,0);
 stabilizePoseLandmarks(tracker,p,100);
 set(p,13,1,.5,0,false);set(p,14,-1,-.5,0,false);
 const got=stabilizePoseLandmarks(tracker,p,160);
 assert.equal(got.recovered,2);
 assert.ok(got.landmarks[13].y>0);
 assert.ok(got.landmarks[14].y<0);
});
test('knee uses the same geometric solver without changing other leg',()=>{
 const tracker=createSmartPoseTracker(),p=points();
 set(p,23,0,0);set(p,25,.5,-1);set(p,27,0,-2);
 set(p,24,2,0);set(p,26,2,-1);set(p,28,2,-2);
 stabilizePoseLandmarks(tracker,p,500);
 set(p,25,.5,-1,0,false);
 const got=stabilizePoseLandmarks(tracker,p,560);
 assert.equal(got.recovered,1);
 assert.ok(got.landmarks[25].inferred);
 assert.equal(got.landmarks[26],p[26]);
});
test('outlier elbow is rejected and reconstructed only when recent prior data exists',()=>{
 const tracker=createSmartPoseTracker(),p=points();
 set(p,11,0,0);set(p,13,.9,.7);set(p,15,2,0);
 stabilizePoseLandmarks(tracker,p,100);
 set(p,13,8,7);
 let got=stabilizePoseLandmarks(tracker,p,120);
 assert.equal(got.recovered,1);
 assert.equal(got.rejected,1);
 assert.ok(got.landmarks[13].x<3);
 got=stabilizePoseLandmarks(tracker,p,900);
 assert.equal(got.recovered,0);
 assert.equal(got.landmarks[13].visibility,0);
});
test('a joint without a prior reliable bend is never fabricated',()=>{
 const tracker=createSmartPoseTracker(),p=points();
 set(p,11,0,0);set(p,15,2,0);
 const got=stabilizePoseLandmarks(tracker,p,1000);
 assert.equal(got.recovered,0);
 assert.ok(!got.landmarks[13].inferred);
});
test('unreachable or degenerate wrist measurements safely abandon IK',()=>{
 const t=createSmartPoseTracker(),p=points();
 set(p,11,0,0);set(p,13,1,.6);set(p,15,2,0);
 stabilizePoseLandmarks(t,p,100);
 set(p,13,0,0,0,false);set(p,15,30,0);
 const got=stabilizePoseLandmarks(t,p,140);
 assert.equal(got.recovered,0);
 assert.equal(reconstructMiddle(p[11],p[11],p[15],1,1),null);
});
test('restart / character switch clears all IK history',()=>{
 const t=createSmartPoseTracker(),p=points();
 set(p,11,0,0);set(p,13,1,.6);set(p,15,2,0);
 stabilizePoseLandmarks(t,p,100);
 resetSmartPoseTracker(t);
 set(p,13,0,0,0,false);
 assert.equal(stabilizePoseLandmarks(t,p,125).recovered,0);
});
