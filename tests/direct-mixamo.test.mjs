import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRetargetMap} from '../src/character.js';
import {createDirectMixamoDriver,fitMixamoDirections,captureDirectMixamoPose,applyDirectMixamoPose}
 from '../src/direct-mixamo.js';

function makeRig(yaw=0){
 const group=new THREE.Group();group.rotation.y=yaw;
 const hips=new THREE.Bone();hips.name='mixamorigHips';group.add(hips);
 const spine=new THREE.Bone();spine.name='mixamorigSpine1';spine.position.y=.4;hips.add(spine);
 const makeArm=(side,sign)=>{
  const shoulder=new THREE.Bone();shoulder.name='mixamorig'+side+'Shoulder';shoulder.position.x=sign*.25;spine.add(shoulder);
  const arm=new THREE.Bone();arm.name='mixamorig'+side+'Arm';arm.position.x=sign*.10;shoulder.add(arm);
  const forearm=new THREE.Bone();forearm.name='mixamorig'+side+'ForeArm';forearm.position.x=sign*.35;arm.add(forearm);
  const hand=new THREE.Bone();hand.name='mixamorig'+side+'Hand';hand.position.x=sign*.28;forearm.add(hand);
  return {arm,forearm,hand,shoulder};
 };
 const left=makeArm('Left',1),right=makeArm('Right',-1);
 group.updateWorldMatrix(true,true);
 return {group,hips,spine,left,right};
}
function create(yaw=0){
 const src=makeRig(),target=makeRig(yaw);
 const bones=[];src.group.traverse(n=>{if(n.isBone)bones.push(n);});
 const mapping=buildRetargetMap(bones,target.group);
 const driver=createDirectMixamoDriver(mapping);
 return {src,target,mapping,driver};
}
test('left arm rises in imported Mixamo skeleton while right arm and torso remain stable',()=>{
 const {driver,target}=create();
 const before=target.right.arm.quaternion.clone();
 assert.equal(fitMixamoDirections(driver,{LeftArm:[0,1,0]},1000),1);
 assert.ok(target.left.arm.quaternion.angleTo(new THREE.Quaternion())>1);
 assert.ok(target.right.arm.quaternion.angleTo(before)<1e-8);
 assert.ok(target.spine.quaternion.angleTo(new THREE.Quaternion())<1e-8);
});
test('works for a character exported facing the opposite direction',()=>{
 const {driver,target}=create(Math.PI);
 assert.equal(fitMixamoDirections(driver,{LeftArm:[0,1,0]},1000,{smoothing:1}),1);
 target.left.arm.updateWorldMatrix(true,true);
 const arm=target.left.arm,forearm=target.left.forearm;
 const a=arm.getWorldPosition(new THREE.Vector3());
 const b=forearm.getWorldPosition(new THREE.Vector3());
 assert.ok(b.sub(a).normalize().dot(new THREE.Vector3(0,1,0))>.98);
});
test('one side occluded never steals the other side and returns to bind pose gradually',()=>{
 const {driver,target}=create();
 fitMixamoDirections(driver,{LeftArm:[0,1,0]},1000);
 const moved=target.left.arm.quaternion.clone();
 fitMixamoDirections(driver,{RightArm:[0,-1,0]},1100);
 assert.ok(target.left.arm.quaternion.angleTo(moved)<1e-6);
 fitMixamoDirections(driver,{},1800);
 assert.ok(target.left.arm.quaternion.angleTo(new THREE.Quaternion())<
   moved.angleTo(new THREE.Quaternion()));
});
test('pose captured from actual target GLB is the one reproduced by playback/export',()=>{
 const {driver,target}=create();
 fitMixamoDirections(driver,{LeftArm:[0,1,0],RightArm:[0,-1,0]},2000);
 const frame=captureDirectMixamoPose(driver);
 const q=target.left.arm.quaternion.clone();
 target.left.arm.quaternion.identity();
 applyDirectMixamoPose(driver,frame);
 assert.ok(target.left.arm.quaternion.angleTo(q)<1e-6);
 assert.ok(frame.mixamorigRightArm);
});
test('non-finite or missing input cannot rotate joints',()=>{
 const {driver,target}=create();
 fitMixamoDirections(driver,{LeftArm:[NaN,0,0],RightArm:[0,0,0]},1000);
 assert.ok(target.left.arm.quaternion.angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(target.right.arm.quaternion.angleTo(new THREE.Quaternion())<1e-8);
});
