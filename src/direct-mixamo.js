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
  // Camera pose cannot measure pelvis translation, finger roll or toes reliably.
  'hips','leftshoulder','rightshoulder','leftfoot','rightfoot',
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
  return {joints,byKey,orientation,calibration:{torso:null,head:null},
    torsoLastSeen:-Infinity,headLastSeen:-Infinity};
}
// Calibrate separately for each loaded character and camera source.
// First reliably visible upright body becomes the zero-pose reference.
export function resetDirectMixamoCalibration(driver){
  if(!driver)return;
  driver.calibration={torso:null,head:null};
  driver.torsoLastSeen=-Infinity;
  driver.headLastSeen=-Infinity;
  for(const joint of driver.joints){
    joint.lastSeen=-Infinity;
    joint.bone.quaternion.copy(joint.rest);
  }
  driver.joints[0]?.bone.updateWorldMatrix(true,true);
}
function easeToRest(joint,now,lastSeen,missingMs){
  if(joint && now-lastSeen>missingMs)joint.bone.quaternion.slerp(joint.rest,.16);
}
function updateTrunk(driver,directions,now,alpha,missingMs){
  const spine=driver.byKey.get('spine1')||driver.byKey.get('spine');
  const chest=driver.byKey.get('spine2');
  const neck=driver.byKey.get('neck');
  const head=driver.byKey.get('head');
  const torso=directionOf(directions?.Spine1);
  if(torso && torso.y>.55){
    // Camera centreline is NOT the root transform: only distribute a small
    // incremental lean from a calibrated upright posture across spine bones.
    const world=torso.clone().applyQuaternion(driver.orientation).normalize();
    if(!driver.calibration.torso)driver.calibration.torso=world.clone();
    driver.torsoLastSeen=now;
    const angle=driver.calibration.torso.angleTo(world);
    if(Number.isFinite(angle)&&angle<THREE.MathUtils.degToRad(55)){
      const baseSwing=new THREE.Quaternion().setFromUnitVectors(driver.calibration.torso,world);
      for(const [j,fraction] of [[spine,.48],[chest,.35]]){
        if(!j)continue;
        j.bone.parent.updateWorldMatrix(true,false);
        const parentWorld=j.bone.parent.getWorldQuaternion(new THREE.Quaternion());
        const localSwing=parentWorld.clone().invert().multiply(baseSwing)
          .multiply(parentWorld).normalize();
        const weighted=new THREE.Quaternion().identity().slerp(localSwing,fraction);
        const proposed=weighted.multiply(j.rest.clone());
        const safe=clampJointQuaternion(j.bone.name,j.rest,proposed);
        j.bone.quaternion.slerp(safe,alpha*.55);
      }
    }
  }else{
    easeToRest(spine,now,driver.torsoLastSeen,missingMs);
    easeToRest(chest,now,driver.torsoLastSeen,missingMs);
  }
  const pose=directions?.Head;
  if(Array.isArray(pose)&&pose.length===3&&pose.every(Number.isFinite)){
    if(!driver.calibration.head)driver.calibration.head=[...pose];
    driver.headLastSeen=now;
    const delta=pose.map((v,i)=>THREE.MathUtils.clamp(
      v-driver.calibration.head[i],-.38,.38));
    const rotation=new THREE.Quaternion().setFromEuler(
      new THREE.Euler(delta[0],delta[1],delta[2],'XYZ'));
    for(const [j,weight] of [[neck,.25],[head,.75]]){
      if(!j)continue;
      const weighted=new THREE.Quaternion().identity().slerp(rotation,weight);
      const candidate=j.rest.clone().multiply(weighted);
      j.bone.quaternion.slerp(clampJointQuaternion(j.bone.name,j.rest,candidate),alpha*.7);
    }
  }else{
    easeToRest(neck,now,driver.headLastSeen,missingMs);
    easeToRest(head,now,driver.headLastSeen,missingMs);
  }
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
  updateTrunk(driver,directions,now,alpha,missingMs);
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
