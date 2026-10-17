import * as THREE from 'three';
import {clampJointQuaternion} from './character.js';

// A camera segment is expressed in model/world axes. The corresponding
// skeleton bone quaternion is LOCAL to its parent, so we must convert it
// to parent space and rotate from the bone's actual REST direction.
// Do not orient shoulders independently from the same upper-arm segment:
// that double-applies the motion and leaves elbows bent above the head.
export function fitMannequinBone(bone,direction,rest,alpha=.8){
 if(!bone?.isBone || !rest?.isQuaternion || !Array.isArray(direction)||
    direction.length!==3 || !direction.every(Number.isFinite))return false;
 const desired=new THREE.Vector3(...direction);
 if(desired.lengthSq()<1e-9)return false;
 const child=bone.children.find(n=>n.isBone&&n.position.lengthSq()>1e-9);
 let reference=child?.position.clone();
 if(!reference&&bone.name.endsWith('LeftHand'))reference=new THREE.Vector3(1,0,0);
 if(!reference&&bone.name.endsWith('RightHand'))reference=new THREE.Vector3(-1,0,0);
 if(!reference)return false;
 bone.parent.updateWorldMatrix(true,false);
 const parentRotation=bone.parent.getWorldQuaternion(new THREE.Quaternion());
 desired.normalize().applyQuaternion(parentRotation.invert());
 const original=reference.applyQuaternion(rest).normalize();
 const swing=new THREE.Quaternion().setFromUnitVectors(original,desired);
 const proposed=swing.multiply(rest.clone()).normalize();
 const safe=clampJointQuaternion(bone.name,rest,proposed);
 bone.quaternion.slerp(safe,THREE.MathUtils.clamp(alpha,.05,1));
 return true;
}
