// Synchronize the projected direction of each independently observed limb
// with MediaPipe's BLUE 2D skeleton, while retaining measured 3D depth for
// real forward punches. A single-camera world-landmark Z estimate can easily
// overpower the X/Y image measurement and make a clearly raised arm point
// into the camera instead of upwards.
//
// Only fuse unoccluded directions while the actor faces the camera. The
// existing world-space rig driver remains the fallback when turned side/back.
const SEGMENTS=[
 'LeftArm','LeftForeArm','RightArm','RightForeArm',
 'LeftUpLeg','LeftLeg','RightUpLeg','RightLeg'
];
const finite3=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
const magnitude=(x,y)=>Math.hypot(x,y);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const headingDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

// A screen vector is normalized in image coordinates (0..1 on each axis).
// Correct the X aspect when measuring angles/foreshortening in physical pixels.
export function fuseProjectedSegment(screen,world,{aspect=4/3,depthWeight=.8}={}){
 if(!finite3(screen))return finite3(world)?[...world]:null;
 if(!Number.isFinite(aspect)||aspect<=0)aspect=1;
 const x=screen[0]*aspect,y=screen[1],imageExtent=magnitude(x,y);
 if(imageExtent<.012){
  // When a limb points straight at the camera, its XY projection can vanish;
  // keeping the actual 3D landmark prevents a punch becoming a zero vector.
  return finite3(world)?[...world]:null;
 }
 const xy=[x/imageExtent,y/imageExtent];
 if(!finite3(world))return [xy[0],xy[1],0];
 const worldXY=magnitude(world[0],world[1]);
 if(worldXY<1e-7){
  // With a small visible projection, a depth-dominant segment is real,
  // but do not permit inferred Z to erase a large visible vertical raise.
  const maxRatio=imageExtent>=.105?.33:imageExtent>=.065?.65:3.5;
  return [xy[0],xy[1],Math.sign(world[2])*maxRatio];
 }
 // For large, visible shoulder->elbow projections, 3D Z (which may be a
 // poorly measured depth hallucination) cannot steal the entire elevation.
 // Short projected segments retain depth to show reaching into the camera.
 const maxRatio=imageExtent>=.105?.33:imageExtent>=.065?.65:3.5;
 const ratio=clamp(world[2]/worldXY*depthWeight,-maxRatio,maxRatio);
 return [xy[0],xy[1],ratio];
}

// Intentionally no mirror flag: LEFT and RIGHT always use semantic indices.
// Head yaw, spine and root heading remain the original 3D calculations.
export function mergeScreenGuidedDirections(worldDirs,screenDirs,options={}){
 const original=worldDirs||{},screen=screenDirs||{};
 if(!options.frontFacing)return {...original};
 const result={...original};
 for(const key of SEGMENTS){
  if(!finite3(original[key])||!finite3(screen[key]))continue;
  const combined=fuseProjectedSegment(screen[key],original[key],options);
  if(combined)result[key]=combined;
 }
 return result;
}

// Guard against applying front-screen projected X/Y after turning sideways:
// it would break the character's 3D perspective and body heading.
export function isFrontFacingPose(imageLandmarks,heading,reference=null,min=.4){
 const left=imageLandmarks?.[11],right=imageLandmarks?.[12];
 const ok=p=>p&&[p.x,p.y].every(Number.isFinite)&&
  (p.visibility??1)>=min&&(p.presence??1)>=min;
 if(!ok(left)||!ok(right)||left.x-right.x<.075)return false;
 if(Number.isFinite(heading)&&Math.abs(headingDelta(heading,0))>.8)return false;
 if(Number.isFinite(heading)&&Number.isFinite(reference)&&
   Math.abs(headingDelta(heading,reference))>.8)return false;
 return true;
}
