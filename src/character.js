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
 const q=sourceQuaternion.isQuaternion?sourceQuaternion:new THREE.Quaternion().fromArray(sourceQuaternion);
 const delta=pair.sourceRest.clone().invert().multiply(q).normalize();
 return pair.targetRest.clone().multiply(pair.basis.clone().multiply(delta).multiply(pair.basisInverse)).normalize();
}
export function retargetTrack(pair,quaternionArray){
 return retargetPose(pair,quaternionArray).toArray();
}
