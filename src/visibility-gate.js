// MediaPipe worldLandmarks include plausible coordinates for joints outside the
// camera frame. These are model estimates, not observed hips/knees/ankles.
// Use normalized 2D image landmarks to decide which 3D joints can drive a GLB.
// This module is intentionally independent of Three.js and MediaPipe runtime.
const LOWER_BODY=[23,24,25,26,27,28,29,30,31,32];
const LEFT_LEG=[23,25,27,29,31];
const RIGHT_LEG=[24,26,28,30,32];
const finite=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const imageVisible=(p,min=.4,margin=.025)=>
  finite(p)&&p.x>=margin&&p.x<=1-margin&&
  p.y>=margin&&p.y<=1-margin&&
  (p.visibility??1)>=min&&(p.presence??1)>=min;
const masked=p=>p?{...p,visibility:0,presence:0}:p;
const average=(a,b)=>(a+b)/2;

export function gateObservedPose(worldLandmarks,imageLandmarks,min=.4){
 if(!Array.isArray(worldLandmarks))return {landmarks:null,coverage:'none',hips:false,legs:false};
 const image=Array.isArray(imageLandmarks)?imageLandmarks:null;
 const result=worldLandmarks.slice();
 // No 2D image geometry means 3D joint coordinates cannot prove that
 // anything below the shoulders is actually in view.
 const good=i=>Boolean(image && imageVisible(image[i],min));
 // Offscreen model-estimated wrists, elbows and even faces are not observed.
 // This preserves joints that really are in frame, unlike disabling an
 // entire limb group whenever lower-body framing is incomplete.
 for(let i=0;i<result.length;i++){
   if(!good(i))result[i]=masked(result[i]);
 }
 const shoulders=good(11)&&good(12);
 const shoulderY=shoulders?average(image[11].y,image[12].y):null;
 const hips=Boolean(shoulders&&good(23)&&good(24) &&
   average(image[23].y,image[24].y)-shoulderY>=.12);
 if(!hips){
  for(const i of LOWER_BODY)result[i]=masked(result[i]);
 }else{
  // Do not infer a knee/ankle from world coordinates when that point is
  // clipped out of the actual camera. Each leg is gated independently.
  for(const indices of [LEFT_LEG,RIGHT_LEG]){
   if(!good(indices[1])){
    for(const i of indices.slice(1))result[i]=masked(result[i]);
   }else if(!good(indices[2])){
    for(const i of indices.slice(2))result[i]=masked(result[i]);
   }else{
    for(const i of indices.slice(3))if(!good(i))result[i]=masked(result[i]);
   }
  }
 }
 const legs=hips&&good(25)&&good(26)&&good(27)&&good(28);
 return {landmarks:result,coverage:!shoulders?'none':!hips?'upper':legs?'full':'partial',hips,legs};
}
