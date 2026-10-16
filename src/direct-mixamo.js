import * as THREE from 'three';
import {boneKey, clampJointQuaternion} from './character.js';

// Stable, direct fitting for existing Mixamo-compatible SkinnedMesh rigs.
// Unlike mannequin rotation retargeting, use the imported model's OWN bone
// direction and rest quaternion. This keeps clothes/skinning in their bind
// basis and prevents parent twist from a camera with missing lower-body points.
const DRIVEN = new Set([
  'leftarm','leftforearm','rightarm','rightforearm',
  'leftupleg','leftleg','rightupleg','rightleg'
]);
const KEEP_NEUTRAL = new Set([
  'hips','spine','spine1','spine2','neck',
  'leftshoulder','rightshoulder','leftfoot','rightfoot',
  'lefthand','righthand'
]);
const directionOf = value => {
  if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite))return null;
  const v=new THREE.Vector3(...value);
  return v.lengthSq()>1e-6 ? v.normalize() : null;
};
export function createDirectMixamoDriver(mapping){
  const joints=[];
  for(const pair of mapping){
    const key=boneKey(pair.sourceName);
    const bone=pair.target;
    // For a bone like LeftArm, the local rest reference is its CHILD offset
    // to LeftForeArm, not the parent's shoulder offset.
    const child=bone.children.find(n=>n.isBone && n.position.lengthSq()>1e-8);
    const ref=child?.position.clone();
    joints.push({
      key,sourceName:pair.sourceName,bone,rest:pair.targetRest.clone(),
      childReference:ref,lastSeen:-Infinity
    });
  }
  const byKey=new Map(joints.map(j=>[j.key,j]));
  // Match the model's shoulder axis rather than assuming every exported
  // avatar faces +Z. This compensates for 180-degree Mixamo GLB orientation.
  const left=byKey.get('leftarm')?.bone,right=byKey.get('rightarm')?.bone;
  const axis=left&&right?
    left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3())):null;
  if(axis)axis.y=0;
  const yaw=axis?.lengthSq()>1e-8 ? -Math.atan2(axis.z,axis.x) : 0;
  const orientation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);
  return {joints,byKey,orientation};
}
export function fitMixamoDirections(driver,directions,now=0,{smoothing=.78,missingMs=550}={}){
  if(!driver)return 0;
  const alpha=THREE.MathUtils.clamp(smoothing,.05,1);
  let changed=0;
  // Keep trunk stable for incomplete / dark camera views. Never bend the
  // abdomen because one raised arm shifts the visible shoulder midpoint.
  for(const j of driver.joints){
    if(KEEP_NEUTRAL.has(j.key)){
      j.bone.quaternion.copy(j.rest);
    }
  }
  for(const j of driver.joints){
    if(!DRIVEN.has(j.key))continue;
    const desired=directionOf(directions?.[j.sourceName.slice(9)]);
    if(!desired || !j.childReference){
      // Invalid or occluded landmarks must not drag OTHER bones.
      if(now-j.lastSeen>missingMs){
        j.bone.quaternion.slerp(j.rest,.20);
      }
      continue;
    }
    j.lastSeen=now;
    j.bone.parent.updateWorldMatrix(true,false);
    const parentWorld=j.bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const localDesired=desired.clone().applyQuaternion(driver.orientation).applyQuaternion(parentWorld.invert()).normalize();
    const restDirection=j.childReference.clone().applyQuaternion(j.rest).normalize();
    // Preserve the actual GLB bone roll. The shortest swing from REST
    // direction to the detected limb direction has no arbitrary axial twist.
    const swing=new THREE.Quaternion().setFromUnitVectors(restDirection,localDesired);
    const raw=swing.multiply(j.rest);
    const safe=clampJointQuaternion(j.bone.name,j.rest,raw);
    j.bone.quaternion.slerp(safe,alpha);
    changed++;
  }
  if(driver.joints.length)driver.joints[0].bone.updateWorldMatrix(true,true);
  return changed;
}
export function captureDirectMixamoPose(driver){
  const out={};
  for(const j of driver?.joints||[])out[j.sourceName]=j.bone.quaternion.toArray();
  return out;
}
export function applyDirectMixamoPose(driver,pose){
  if(!driver||!pose)return;
  for(const j of driver.joints){
    const q=pose[j.sourceName];
    if(Array.isArray(q)&&q.length===4&&q.every(Number.isFinite))
      j.bone.quaternion.fromArray(q).normalize();
  }
  if(driver.joints.length)driver.joints[0].bone.updateWorldMatrix(true,true);
}
