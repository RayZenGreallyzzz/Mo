// Continuously unwrap actor heading; never snap at +/-180 degrees.
export function shortestHeadingDelta(a,b){
 if(!Number.isFinite(a)||!Number.isFinite(b))return 0;
 return Math.atan2(Math.sin(a-b),Math.cos(a-b));
}
export function updateCalibratedHeading(state,rawYaw,{smoothing=.62,maxStep=.48}={}){
 if(!Number.isFinite(rawYaw))return state?.offset||0;
 if(!Number.isFinite(state.reference)){
  state.reference=rawYaw;
  state.offset=0;
  return 0;
 }
 const desired=shortestHeadingDelta(rawYaw,state.reference);
 const diff=shortestHeadingDelta(desired,state.offset||0);
 const step=Math.max(-maxStep,Math.min(maxStep,diff*smoothing));
 state.offset=shortestHeadingDelta((state.offset||0)+step,0);
 return state.offset;
}
export function resetHeading(state){
 if(!state)return;
 state.reference=null;state.offset=0;
}
