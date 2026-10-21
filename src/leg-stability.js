// Conservative single-leg isolation for one-camera Mixamo capture.
// Standing baseline is per camera/model session; torso/head motion cannot
// invent two lifted legs from nearly unchanged leg directions.
const entries={
 Left:['LeftUpLeg','LeftLeg'],
 Right:['RightUpLeg','RightLeg']
};
const vector=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)
  ?a:null;
const norm=a=>{
 const len=Math.hypot(...a);
 return len>1e-6?a.map(n=>n/len):null;
};
const angle=(a,b)=>{
 const x=vector(a),y=vector(b);
 if(!x||!y)return null;
 const n=norm(x),m=norm(y);if(!n||!m)return null;
 const cos=n.reduce((sum,v,i)=>sum+v*m[i],0);
 return Math.acos(Math.min(1,Math.max(-1,cos)));
};
export function createLegStability(){
 return {reference:null};
}
export function resetLegStability(memory){
 if(memory)memory.reference=null;
}
export function classifyLegActivity(memory,directions){
 const d=directions||{};
 // Never use an image that starts mid-kick to define "standing".
 if(!memory.reference){
   const pose=Object.values(entries).flat();
   if(pose.every(name=>{
     const v=vector(d[name]);
     const unit=v&&norm(v);
     return !!unit&&unit[1]<-.72;
   })){
     memory.reference=Object.fromEntries(pose.map(name=>[name,[...d[name]]]));
   }else{
     return {calibrated:false,activeLeft:false,activeRight:false,lockLeft:true,lockRight:true};
   }
 }
 const motions={};
 for(const [side,names] of Object.entries(entries)){
   const a=angle(d[names[0]],memory.reference[names[0]]);
   const b=angle(d[names[1]],memory.reference[names[1]]);
   // A missing segment cannot be interpreted as movement.
   motions[side]=a===null&&b===null?null:Math.max(a??0,(b??0)*.80);
 }
 const left=motions.Left,right=motions.Right;
 // Ignore camera jitter below about 8 degrees. The old 13-degree deadband
 // made deliberate short steps and small knee movements look frozen.
 const deadband=.14;
 let lockLeft=left===null||left<deadband;
 let lockRight=right===null||right<deadband;
 // Clear unilateral lifts must never drive the support leg, even when
 // landmarks on that side wobble due to camera perspective / occlusion.
 if(left!==null&&right!==null){
   if(left>.37 && right<.31 && left-right>.22)lockRight=true;
   if(right>.37 && left<.31 && right-left>.22)lockLeft=true;
 }
 return {calibrated:true,activeLeft:!lockLeft,activeRight:!lockRight,
   lockLeft,lockRight,motions};
}
