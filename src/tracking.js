// Pure, independently testable MediaPipe 33-landmark → mannequin directions.
// CSS mirror is NOT an input. Semantic Left never drives semantic Right.
const LIMBS=[
 ['LeftArm',11,13],['LeftForeArm',13,15],['LeftHand',15,19],
 ['RightArm',12,14],['RightForeArm',14,16],['RightHand',16,20],
 ['LeftUpLeg',23,25],['LeftLeg',25,27],['LeftFoot',27,31],
 ['RightUpLeg',24,26],['RightLeg',26,28],['RightFoot',28,32]
];
const exists=(data,i,min)=>{
 const v=data?.[i];return v&&[v.x,v.y,v.z].every(Number.isFinite)&&
  (v.visibility??1)>=min&&(v.presence??1)>=min;
};
const project=(p,sign)=>[p.x*sign,-p.y,-p.z];
function diff(a,b){return [b[0]-a[0],b[1]-a[1],b[2]-a[2]];}
const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
export function trackingSign(landmarks,minVisibility=.4){
 if(!exists(landmarks,11,minVisibility)||!exists(landmarks,12,minVisibility))return null;
 const dx=landmarks[11].x-landmarks[12].x;
 return Math.abs(dx)<.035?null:(dx>0?1:-1);
}
export function deriveDirections(landmarks,minVisibility=.4,xSign=1){
 const out={};
 const get=i=>exists(landmarks,i,minVisibility)?project(landmarks[i],xSign):null;
 const getVec=(from,to)=>{const a=get(from),b=get(to);return a&&b?diff(a,b):null;};
 for(const [name,a,b] of LIMBS){const d=getVec(a,b);if(d)out[name]=d;}
 const ls=get(11),rs=get(12),lh=get(23),rh=get(24);
 const shoulder=ls&&rs?mid(ls,rs):null,hips=lh&&rh?mid(lh,rh):null;
 // Signed 3D shoulder line tells us whether the actor faces camera,
 // turns side-on or faces away. Unlike a 2D shoulder-width heuristic,
 // it continues through profile using depth. Never infer yaw from an
 // extended arm; that would rotate the whole actor during punches.
 const shoulderAxis=ls&&rs?diff(rs,ls):null;
 const hipAxis=lh&&rh?diff(rh,lh):null;
 const horizontal=a=>a?[a[0],a[2]]:null;
 const usable=a=>a&&Math.hypot(...a)>.075;
 const sa=horizontal(shoulderAxis),ha=horizontal(hipAxis);
 if(usable(sa)||usable(ha)){
   let axis=usable(sa)?sa:ha;
   // Hips help when they agree with shoulders but cannot override a
   // clearly detected shoulder rotation with unrelated occlusion noise.
   if(usable(sa)&&usable(ha)){
     const dot=(sa[0]*ha[0]+sa[1]*ha[1])/(Math.hypot(...sa)*Math.hypot(...ha));
     if(dot>.55)axis=[sa[0]*.8+ha[0]*.2,sa[1]*.8+ha[1]*.2];
   }
   out.BodyYaw=Math.atan2(axis[1],axis[0]);
 }
 if(shoulder&&hips){out.Spine1=diff(hips,shoulder);out.Spine2=diff(hips,shoulder);}
 if(ls&&rs){out.LeftShoulder=diff(shoulder,ls);out.RightShoulder=diff(shoulder,rs);}
 const hipsAxis=lh&&rh?diff(rh,lh):null;
 if(hipsAxis)out.Hips=[hipsAxis[1]*.16,1,hipsAxis[0]*-.20];
 const le=get(7),re=get(8),nose=get(0);
 const headCentre=le&&re?mid(le,re):null;
 if(shoulder&&headCentre)out.Neck=diff(shoulder,headCentre);
 if(headCentre&&nose&&le&&re){
  const width=Math.max(.04,Math.hypot(le[0]-re[0],le[1]-re[1],le[2]-re[2]));
  const yaw=Math.max(-.55,Math.min(.55,(nose[0]-headCentre[0])/width*.65));
  const roll=Math.max(-.45,Math.min(.45,(le[1]-re[1])/width*.8));
  const pitch=Math.max(-.45,Math.min(.45,((nose[2]-headCentre[2])-.06)/width*.48));
  out.Head=[pitch,yaw,roll];
 }
 return out;
}
