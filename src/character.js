import * as THREE from 'three';

// GLB skeletons are matched by semantic joint names. Never rename a real bone:
// GLB skins and clips refer to their actual nodes, not our UI labels.
export function boneKey(name){
 let s=String(name||'').split(/[|/:\\]/).pop().replace(/^mixamorig\d*[:_]?/i,'')
  .replace(/[^a-z0-9]/gi,'').toLowerCase();
 const aliases={pelvis:'hips',root:'hips',leftupperarm:'leftarm',rightupperarm:'rightarm',
 leftlowerarm:'leftforearm',rightlowerarm:'rightforearm',leftthigh:'leftupleg',
 rightthigh:'rightupleg',leftshin:'leftleg',rightshin:'rightleg',
 leftcalf:'leftleg',rightcalf:'rightleg',leftankle:'leftfoot',rightankle:'rightfoot',
 chest:'spine2',upperchest:'spine2'};
 return aliases[s]||s;
}

// Camera landmarks describe segment DIRECTION, not bone roll/twist. Never
// transfer an unconstrained 180-degree guess to a rigged GLB: one bad partial
// detection can fold the spine/neck, invert knees or twist skinned clothes.
// Conservative limits are deliberately lower for the torso than extremities.
const LIMIT_DEGREES={
 hips:12,spine:16,spine1:16,spine2:16,neck:22,head:48,
 leftshoulder:55,rightshoulder:55,
 leftarm:135,rightarm:135,
 leftforearm:145,rightforearm:145,
 lefthand:65,righthand:65,
 leftupleg:105,rightupleg:105,
 leftleg:115,rightleg:115,
 leftfoot:65,rightfoot:65
};
export function jointLimitDegrees(name){
 return LIMIT_DEGREES[boneKey(name)] ?? 70;
}
export function clampJointQuaternion(name,rest,proposed){
 const base=rest.clone().normalize();
 if(!proposed||![proposed.x,proposed.y,proposed.z,proposed.w].every(Number.isFinite))return base;
 const candidate=proposed.clone().normalize();
 const angle=base.angleTo(candidate);
 const limit=THREE.MathUtils.degToRad(jointLimitDegrees(name));
 if(!Number.isFinite(angle))return base;
 if(angle>limit)return base.rotateTowards(candidate,limit).normalize();
 return candidate;
}
export function buildRetargetMap(sourceBones,targetRoot){
 if(!targetRoot?.traverse||!Array.isArray(sourceBones))return [];
 const targets=new Map();
 targetRoot.updateWorldMatrix(true,true);
 targetRoot.traverse(n=>{if(n.isBone){const k=boneKey(n.name);if(!targets.has(k))targets.set(k,n);}});
 const sourceRestWorld=new Map();
 for(const b of sourceBones){b.updateWorldMatrix(true,false);sourceRestWorld.set(b.name,b.getWorldQuaternion(new THREE.Quaternion()));}
 const mapping=[];
 for(const source of sourceBones){
  const target=targets.get(boneKey(source.name));
  if(!target)continue;
  const sourceWorld=sourceRestWorld.get(source.name);
  const targetWorld=target.getWorldQuaternion(new THREE.Quaternion());
  const basis=targetWorld.clone().invert().multiply(sourceWorld).normalize();
  mapping.push({sourceName:source.name,sourceRest:source.quaternion.clone(),target,
   targetRest:target.quaternion.clone(),basis,basisInverse:basis.clone().invert()});
 }
 return mapping;
}
export function retargetPose(pair,sourceQuaternion){
 const q=sourceQuaternion?.isQuaternion?sourceQuaternion:
  new THREE.Quaternion().fromArray(sourceQuaternion);
 if(![q.x,q.y,q.z,q.w].every(Number.isFinite))return pair.targetRest.clone();
 const delta=pair.sourceRest.clone().invert().multiply(q).normalize();
 const raw=pair.targetRest.clone().multiply(
  pair.basis.clone().multiply(delta).multiply(pair.basisInverse)).normalize();
 // Apply identical safety to preview and GLB export. Keep target rest pose as
 // origin, including Mixamo A-pose, custom shoulders and bone local axes.
 return clampJointQuaternion(pair.target.name,pair.targetRest,raw);
}
export function retargetTrack(pair,quaternionArray){
 return retargetPose(pair,quaternionArray).toArray();
}
