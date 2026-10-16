import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildRetargetMap} from '../src/character.js';
import {createDirectMixamoDriver,fitMixamoDirections,captureDirectMixamoPose,applyDirectMixamoPose,resetDirectMixamoCalibration}
 from '../src/direct-mixamo.js';

function makeRig(yaw=0){
 const group=new THREE.Group();group.rotation.y=yaw;
 const hips=new THREE.Bone();hips.name='mixamorigHips';group.add(hips);
 const spine=new THREE.Bone();spine.name='mixamorigSpine1';spine.position.y=.4;hips.add(spine);
 const chest=new THREE.Bone();chest.name='mixamorigSpine2';chest.position.y=.18;spine.add(chest);
 const neck=new THREE.Bone();neck.name='mixamorigNeck';neck.position.y=.16;chest.add(neck);
 const head=new THREE.Bone();head.name='mixamorigHead';head.position.y=.15;neck.add(head);
 const makeArm=(side,sign)=>{
  const shoulder=new THREE.Bone();shoulder.name='mixamorig'+side+'Shoulder';shoulder.position.x=sign*.25;chest.add(shoulder);
  const arm=new THREE.Bone();arm.name='mixamorig'+side+'Arm';arm.position.x=sign*.10;shoulder.add(arm);
  const forearm=new THREE.Bone();forearm.name='mixamorig'+side+'ForeArm';forearm.position.x=sign*.35;arm.add(forearm);
  const hand=new THREE.Bone();hand.name='mixamorig'+side+'Hand';hand.position.x=sign*.28;forearm.add(hand);
  return {arm,forearm,hand,shoulder};
 };
 const left=makeArm('Left',1),right=makeArm('Right',-1);
 const leg=(side,sign)=>{
   const upper=new THREE.Bone();upper.name='mixamorig'+side+'UpLeg';
   upper.position.x=sign*.16;hips.add(upper);
   const knee=new THREE.Bone();knee.name='mixamorig'+side+'Leg';
   knee.position.y=-.5;upper.add(knee);
   const foot=new THREE.Bone();foot.name='mixamorig'+side+'Foot';
   foot.position.y=-.45;knee.add(foot);
   return {upper,knee,foot};
 };
 const leftLeg=leg('Left',1),rightLeg=leg('Right',-1);
 group.updateWorldMatrix(true,true);
 return {group,hips,spine,chest,neck,head,left,right,leftLeg,rightLeg};
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

test('calibrated camera torso and head move without moving pelvis',()=>{
 const {driver,target}=create();
 fitMixamoDirections(driver,{Spine1:[0,1,0],Head:[0,0,0]},1000);
 assert.ok(target.spine.quaternion.angleTo(new THREE.Quaternion())<1e-8);
 fitMixamoDirections(driver,{Spine1:[.26,.96,0],Head:[.20,.19,-.15]},1100);
 assert.ok(target.spine.quaternion.angleTo(new THREE.Quaternion())>.01);
 assert.ok(target.chest.quaternion.angleTo(new THREE.Quaternion())>.01);
 assert.ok(target.head.quaternion.angleTo(new THREE.Quaternion())>.01);
 assert.ok(target.neck.quaternion.angleTo(new THREE.Quaternion())>.005);
 assert.ok(target.hips.quaternion.angleTo(new THREE.Quaternion())<1e-8);
});
test('head and torso stop applying bad landmarks and re-calibration restores neutral',()=>{
 const {driver,target}=create();
 fitMixamoDirections(driver,{Spine1:[0,1,0],Head:[0,0,0]},1000);
 fitMixamoDirections(driver,{Spine1:[.25,.96,0],Head:[.17,.10,0]},1100);
 const angled=target.spine.quaternion.angleTo(new THREE.Quaternion());
 fitMixamoDirections(driver,{Spine1:[1,0,0],Head:[NaN,0,0]},2000);
 assert.ok(target.spine.quaternion.angleTo(new THREE.Quaternion())<angled);
 resetDirectMixamoCalibration(driver);
 assert.ok(target.spine.quaternion.angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(target.head.quaternion.angleTo(new THREE.Quaternion())<1e-8);
 fitMixamoDirections(driver,{Spine1:[.25,.96,0],Head:[.17,.10,0]},2200);
 assert.ok(target.spine.quaternion.angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(target.head.quaternion.angleTo(new THREE.Quaternion())<1e-8);
});
test('full-body target rotations are preserved by capture/replay',()=>{
 const {driver,target}=create();
 fitMixamoDirections(driver,{Spine1:[0,1,0],Head:[0,0,0],LeftArm:[1,0,0]},1000);
 fitMixamoDirections(driver,{Spine1:[.22,.97,0],Head:[.10,.15,0],LeftArm:[0,1,0]},1100);
 const frame=captureDirectMixamoPose(driver);
 const oldHead=target.head.quaternion.clone(),oldSpine=target.spine.quaternion.clone();
 target.head.quaternion.identity();target.spine.quaternion.identity();
 applyDirectMixamoPose(driver,frame);
 assert.ok(target.head.quaternion.angleTo(oldHead)<1e-6);
 assert.ok(target.spine.quaternion.angleTo(oldSpine)<1e-6);
});

test('cross-body forward strike bends arm and elbow without rotating opposite arm or hips',()=>{
 const {driver,target}=create();
 const initRight=target.right.arm.quaternion.clone();
 for(let i=0;i<4;i++){
   fitMixamoDirections(driver,{
     LeftArm:[-.25,.12,.96],LeftForeArm:[-.50,.02,.86],
     RightArm:[-1,0,0],Spine1:[0,1,0]
   },1000+i*40);
 }
 assert.ok(target.left.arm.quaternion.angleTo(new THREE.Quaternion())>.2);
 assert.ok(target.left.forearm.quaternion.angleTo(new THREE.Quaternion())>.2);
 assert.ok(target.hips.quaternion.angleTo(new THREE.Quaternion())<1e-8);
 assert.ok(target.right.arm.quaternion.angleTo(initRight)<1e-8);
 assert.ok(target.left.shoulder.quaternion.angleTo(new THREE.Quaternion())<
    THREE.MathUtils.degToRad(13));
 for(const j of driver.joints){
   assert.ok([j.bone.quaternion.x,j.bone.quaternion.y,j.bone.quaternion.z,j.bone.quaternion.w].every(Number.isFinite));
 }
});

test('raising only LEFT leg preserves RIGHT Mixamo hip/knee rest rotations',()=>{
 const {target,driver}=create();
 const standing={
  LeftUpLeg:[0,-1,0],RightUpLeg:[0,-1,0],
  LeftLeg:[0,-1,0],RightLeg:[0,-1,0]
 };
 fitMixamoDirections(driver,standing,1000);
 fitMixamoDirections(driver,{...standing(),
    LeftUpLeg:[.1,-.55,.9],LeftLeg:[.2,-.8,.5],
    RightUpLeg:[.08,-.996,.01],RightLeg:[.05,-.999,0]},1100);
 assert.ok(target.leftLeg.upper.quaternion.angleTo(new THREE.Quaternion())>.2);
 assert.ok(target.rightLeg.upper.quaternion.angleTo(new THREE.Quaternion())<1e-6);
 assert.ok(target.rightLeg.knee.quaternion.angleTo(new THREE.Quaternion())<1e-6);
 assert.ok(target.hips.quaternion.angleTo(new THREE.Quaternion())<1e-6);
});
test('raising only RIGHT leg preserves LEFT Mixamo hip/knee rest rotations',()=>{
 const {target,driver}=create();
 const standing={
  LeftUpLeg:[0,-1,0],RightUpLeg:[0,-1,0],
  LeftLeg:[0,-1,0],RightLeg:[0,-1,0]
 };
 fitMixamoDirections(driver,standing,1000);
 fitMixamoDirections(driver,{...standing(),
    RightUpLeg:[-.12,-.40,.91],RightLeg:[-.1,-.7,.65]},1100);
 assert.ok(target.rightLeg.upper.quaternion.angleTo(new THREE.Quaternion())>.2);
 assert.ok(target.leftLeg.upper.quaternion.angleTo(new THREE.Quaternion())<1e-6);
 assert.ok(target.leftLeg.knee.quaternion.angleTo(new THREE.Quaternion())<1e-6);
});
