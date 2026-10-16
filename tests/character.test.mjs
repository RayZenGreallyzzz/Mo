import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {boneKey,buildRetargetMap,retargetPose,retargetTrack} from '../src/character.js';

function skeleton(prefix='mixamorig'){
 const group=new THREE.Group();
 const hip=new THREE.Bone();hip.name=prefix+'Hips';group.add(hip);
 const left=new THREE.Bone();left.name=prefix+'LeftArm';left.position.x=.35;hip.add(left);
 const right=new THREE.Bone();right.name=prefix+'RightArm';right.position.x=-.35;hip.add(right);
 group.updateWorldMatrix(true,true);
 return {group,hip,left,right};
}
test('original GLB bone names are preserved, left and right are independent',()=>{
 const source=skeleton(),target=skeleton();
 const mapping=buildRetargetMap([source.hip,source.left,source.right],target.group);
 assert.equal(mapping.length,3);
 assert.equal(mapping.find(p=>p.sourceName==='mixamorigLeftArm').target,target.left);
 assert.equal(mapping.find(p=>p.sourceName==='mixamorigRightArm').target,target.right);
 const bend=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.65);
 const pose=retargetPose(mapping.find(p=>p.sourceName==='mixamorigLeftArm'),bend);
 assert.ok(pose.angleTo(bend)<.0001);
 assert.ok(target.right.quaternion.equals(new THREE.Quaternion()));
 assert.equal(boneKey('mixamorig:RightForeArm'),'rightforearm');
 assert.equal(boneKey('LeftLowerArm'),'leftforearm');
});
test('retarget tracks use target rest and do not alter source or GLB bones',()=>{
 const source=skeleton();const target=skeleton();
 target.left.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.3);
 const map=buildRetargetMap([source.hip,source.left,source.right],target.group);
 const pair=map.find(p=>p.sourceName==='mixamorigLeftArm');
 const identity=new THREE.Quaternion().toArray();
 assert.ok(new THREE.Quaternion().fromArray(retargetTrack(pair,identity)).angleTo(pair.targetRest)<.0001);
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.8);
 assert.equal(retargetTrack(pair,q.toArray()).length,4);
 assert.equal(target.left.name,'mixamorigLeftArm');
});

test('unreliable camera direction cannot fold the GLB torso beyond safe limits',()=>{
 const source=skeleton(), target=skeleton();
 const torso=new THREE.Bone();torso.name='mixamorigSpine2';target.hip.add(torso);
 const srcTorso=new THREE.Bone();srcTorso.name='mixamorigSpine2';source.hip.add(srcTorso);
 source.group.updateWorldMatrix(true,true);target.group.updateWorldMatrix(true,true);
 const pairs=buildRetargetMap([srcTorso],target.group);
 const pair=pairs[0];
 const extreme=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI);
 const result=retargetPose(pair,extreme);
 assert.ok(result.angleTo(pair.targetRest)<=THREE.MathUtils.degToRad(16)+1e-5);
 assert.ok(Math.abs(result.length()-1)<1e-6);
});
test('arm pose remains expressive while hips stay at bind rest when only arm moves',()=>{
 const source=skeleton(),target=skeleton();
 const mapping=buildRetargetMap([source.hip,source.left,source.right],target.group);
 const left=mapping.find(p=>p.sourceName==='mixamorigLeftArm');
 const extreme=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI);
 const moved=retargetPose(left,extreme);
 assert.ok(moved.angleTo(left.targetRest)<=THREE.MathUtils.degToRad(135)+1e-5);
 assert.ok(moved.angleTo(left.targetRest)>THREE.MathUtils.degToRad(120));
 assert.ok(target.hip.quaternion.equals(new THREE.Quaternion()));
 assert.ok(target.right.quaternion.equals(new THREE.Quaternion()));
});
test('invalid detected quaternion returns the original target rest pose',()=>{
 const source=skeleton(),target=skeleton();
 const pair=buildRetargetMap([source.left],target.group)[0];
 assert.ok(retargetPose(pair,[NaN,0,0,1]).angleTo(pair.targetRest)<1e-6);
});
