import test from 'node:test';
import assert from 'node:assert/strict';
import {gateObservedPose} from '../src/visibility-gate.js';
import {deriveDirections} from '../src/tracking.js';

const points=()=>Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:.99,presence:.99}));
const put=(a,i,x,y)=>a[i]={x,y,z:0,visibility:.99,presence:.99};
function framed(){
 const image=points(),world=points();
 put(image,11,.35,.22);put(image,12,.65,.22);
 put(image,23,.40,.54);put(image,24,.60,.54);
 put(image,25,.40,.70);put(image,26,.60,.70);
 put(image,27,.40,.90);put(image,28,.60,.90);
 return {image,world};
}
test('user real-video scenario: camera sees face and shoulders, hips outside viewport',()=>{
 const {image,world}=framed();
 put(image,11,.35,.72);put(image,12,.65,.72);
 put(image,23,.42,1.24);put(image,24,.58,1.24);
 put(image,25,.42,1.64);put(image,26,.58,1.64);
 put(image,27,.42,2.15);put(image,28,.58,2.15);
 const before=structuredClone(world);
 const got=gateObservedPose(world,image,.4);
 assert.equal(got.coverage,'upper');assert.equal(got.hips,false);
 assert.equal(got.landmarks[23].visibility,0);
 assert.equal(got.landmarks[25].visibility,0);
 assert.equal(got.landmarks[28].visibility,0);
 const dirs=deriveDirections(got.landmarks,.4);
 assert.equal(dirs.BodyYaw,undefined);
 assert.equal(dirs.LeftUpLeg,undefined);
 assert.equal(dirs.RightUpLeg,undefined);
 assert.ok(dirs.LeftArm===undefined);
 assert.deepEqual(world,before,'original MediaPipe result untouched');
});
test('full-body observed in image preserves all actual leg joints',()=>{
 const {image,world}=framed();
 const got=gateObservedPose(world,image,.4);
 assert.equal(got.coverage,'full');assert.equal(got.hips,true);
 assert.equal(got.legs,true);
 for(const i of [23,24,25,26,27,28])
  assert.equal(got.landmarks[i].visibility,.99);
});
test('partially cropped single leg cannot pull either missing knee or ankle',()=>{
 const {image,world}=framed();
 put(image,25,.40,1.10);put(image,27,.4,1.40);
 const got=gateObservedPose(world,image,.4);
 assert.equal(got.coverage,'partial');assert.equal(got.landmarks[25].visibility,0);
 assert.equal(got.landmarks[27].visibility,0);
 assert.equal(got.landmarks[26].visibility,.99);
 assert.equal(got.landmarks[28].visibility,.99);
});
test('landmarks reported inside image but shoulders and hips are too close to trust',()=>{
 const {image,world}=framed();
 put(image,23,.4,.25);put(image,24,.6,.25);
 const got=gateObservedPose(world,image,.4);
 assert.equal(got.coverage,'upper');
 assert.equal(got.landmarks[23].visibility,0);
});
test('missing 2D image landmarks means NO fake world-landmark leg movement',()=>{
 const {world}=framed();
 const got=gateObservedPose(world,undefined,.4);
 assert.equal(got.coverage,'none');
 assert.equal(got.landmarks[24].visibility,0);
 assert.equal(got.landmarks[28].visibility,0);
});
test('low confidence hip invalidates inferred full body even when inside image',()=>{
 const {image,world}=framed();
 image[24].visibility=.05;
 const got=gateObservedPose(world,image,.4);
 assert.equal(got.coverage,'upper');
 assert.equal(got.landmarks[26].presence,0);
});
