import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {fitMannequinBone} from '../src/mannequin-solver.js';
import {deriveMannequinScreenDirections} from '../src/tracking.js';

function bone(name,x=0,y=0,z=0,parent=null){
 const b=new THREE.Bone();b.name='mixamorig'+name;b.position.set(x,y,z);
 if(parent)parent.add(b);
 return b;
}
function scene(){
 const root=new THREE.Group();
 const hips=bone('Hips',0,1,0,root);
 const chest=bone('Spine2',0,.5,0,hips);
 const neck=bone('Neck',0,.23,0,chest),head=bone('Head',0,.18,0,neck);
 const ls=bone('LeftShoulder',.20,0,0,chest),la=bone('LeftArm',.15,0,0,ls);
 const lf=bone('LeftForeArm',.30,0,0,la),lh=bone('LeftHand',.25,0,0,lf);
 const rs=bone('RightShoulder',-.20,0,0,chest),ra=bone('RightArm',-.15,0,0,rs);
 const rf=bone('RightForeArm',-.30,0,0,ra),rh=bone('RightHand',-.25,0,0,rf);
 root.updateWorldMatrix(true,true);
 return {root,hips,chest,neck,head,ls,la,lf,lh,rs,ra,rf,rh};
}
function direction(parent,child){
 parent.updateWorldMatrix(true,true);
 return child.getWorldPosition(new THREE.Vector3()).sub(
  parent.getWorldPosition(new THREE.Vector3())).normalize();
}
const identity=()=>new THREE.Quaternion();
function fit(b,dir){assert.equal(fitMannequinBone(b,dir,identity(),1),true);}
test('raising BOTH hands produces actual straight arms pointing overhead',()=>{
 const s=scene();
 for(const n of ['la','lf','ra','rf'])fit(s[n],[0,1,0]);
 for(const [a,b] of [[s.la,s.lf],[s.lf,s.lh],[s.ra,s.rf],[s.rf,s.rh]])
  assert.ok(direction(a,b).dot(new THREE.Vector3(0,1,0))>.999);
 for(const n of ['hips','chest','ls','rs','head'])
  assert.ok(s[n].quaternion.angleTo(identity())<1e-8);
});
test('raising one hand never rotates the opposite hand, torso or clavicle',()=>{
 const s=scene();
 fit(s.la,[0,1,0]);fit(s.lf,[0,1,0]);
 assert.ok(direction(s.la,s.lf).y>.99);
 assert.ok(direction(s.ra,s.rf).x<-.99);
 assert.ok(s.rs.quaternion.angleTo(identity())<1e-8);
 assert.ok(s.hips.quaternion.angleTo(identity())<1e-8);
});
test('camera depth allows a punch toward viewer, without tilting head or opposite arm',()=>{
 const s=scene();
 fit(s.la,[0,0,1]);fit(s.lf,[0,0,1]);
 assert.ok(direction(s.la,s.lf).z>.99);
 assert.ok(direction(s.lf,s.lh).z>.99);
 assert.ok(direction(s.ra,s.rf).x<-.99);
 assert.ok(s.head.quaternion.angleTo(identity())<1e-8);
});
test('an imported nonidentity rest joint orientation is preserved by the solver',()=>{
 const root=new THREE.Group();const b=bone('LeftArm',0,0,0,root);
 const child=bone('LeftForeArm',.3,0,0,b);
 b.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.58);
 root.updateWorldMatrix(true,true);
 const rest=b.quaternion.clone();
 assert.equal(fitMannequinBone(b,[0,1,0],rest,1),true);
 assert.ok(direction(b,child).y>.999);
});
test('root yaw is respected when targeting a world-space direction',()=>{
 const s=scene();s.root.rotation.y=.7;s.root.updateWorldMatrix(true,true);
 fit(s.la,[0,1,0]);fit(s.lf,[0,1,0]);
 assert.ok(direction(s.la,s.lf).y>.999);
 assert.ok(direction(s.lf,s.lh).y>.999);
});
test('invisible/NaN camera segments never alter the mannequin',()=>{
 const s=scene();assert.equal(fitMannequinBone(s.la,[NaN,1,0],identity(),1),false);
 assert.equal(fitMannequinBone(s.la,[0,0,0],identity(),1),false);
 assert.ok(s.la.quaternion.angleTo(identity())<1e-8);
});
test('upper-body screen tracking retains signed Z for a forward punch',()=>{
 const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0,presence:0}));
 const set=(i,x,y,z)=>p[i]={x,y,z,visibility:1,presence:1};
 set(11,.62,.35,.05);set(13,.63,.31,-.35);set(15,.64,.31,-.6);
 set(12,.38,.35,.05);set(14,.20,.35,.05);
 const d=deriveMannequinScreenDirections(p,.4);
 assert.ok(d.LeftArm[2]>.2);
 assert.ok(d.LeftForeArm[2]>.1);
 assert.ok(Math.abs(d.LeftArm[0])<.03);
 assert.equal(d.RightArm[2],0);
 assert.ok(d.RightArm[0]<0);
});
