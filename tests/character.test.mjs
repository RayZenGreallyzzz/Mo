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
