// Lightweight, local, temporal two-link reconstruction.
// It is a geometric estimate, NOT a learned action classifier or a fabricated
// canned punch animation. The same rule applies to independently tracked arms
// and legs; an occlusion on one side never samples the other side.
const CHAINS=[
  {name:'left-arm',a:11,b:13,c:15},
  {name:'right-arm',a:12,b:14,c:16},
  {name:'left-leg',a:23,b:25,c:27},
  {name:'right-leg',a:24,b:26,c:28}
];
const finite=p=>p && [p.x,p.y,p.z].every(Number.isFinite);
const visible=(p,threshold)=>finite(p) &&
  (p.visibility??1)>=threshold && (p.presence??1)>=threshold;
const xyz=p=>[p.x,p.y,p.z];
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,k)=>a.map(v=>v*k);
const dot=(a,b)=>a.reduce((acc,v,i)=>acc+v*b[i],0);
const mag=a=>Math.hypot(...a);
const norm=a=>{const d=mag(a);return d>1e-8?mul(a,1/d):null;};
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export function createSmartPoseTracker(){
  return {chains:new Map(CHAINS.map(c=>[c.name,{
    lengths:null,reference:null,lastSeen:-Infinity
  }])),recovered:0,rejected:0};
}
export function resetSmartPoseTracker(state){
  if(!state)return;
  for(const chain of state.chains.values()){
    chain.lengths=null;chain.reference=null;chain.lastSeen=-Infinity;
  }
  state.recovered=0;state.rejected=0;
}
export function reconstructMiddle(a,c,reference,lenA,lenB){
  if(![lenA,lenB].every(v=>Number.isFinite(v)&&v>1e-6))return null;
  const A=xyz(a), C=xyz(c), R=xyz(reference);
  if(![...A,...C,...R].every(Number.isFinite))return null;
  const AC=sub(C,A),d=mag(AC);
  if(d<1e-6)return null;
  // Very far targets are not physically reachable and typically indicate
  // corrupted depth. Do NOT stretch a limb beyond its measured length.
  if(d>lenA+lenB*1.35)return null;
  const direction=mul(AC,1/d);
  const reachable=clamp(d,Math.abs(lenA-lenB)+1e-5,lenA+lenB-1e-5);
  const projection=(lenA*lenA-lenB*lenB+reachable*reachable)/(2*reachable);
  const height=Math.sqrt(Math.max(0,lenA*lenA-projection*projection));
  const axisCentre=add(A,mul(direction,projection));
  let bend=sub(R,add(A,mul(direction,dot(sub(R,A),direction))));
  // If the reference becomes collinear after a full extension, retain a
  // deterministic bend plane rather than rotating the elbow 180 degrees.
  if(mag(bend)<1e-6){
    const seed=Math.abs(direction[1])<.8?[0,1,0]:[0,0,1];
    bend=sub(seed,mul(direction,dot(seed,direction)));
  }
  const perpendicular=norm(bend);
  if(!perpendicular)return null;
  const result=add(axisCentre,mul(perpendicular,height));
  return result.every(Number.isFinite)?{x:result[0],y:result[1],z:result[2]}:null;
}
export function stabilizePoseLandmarks(tracker,landmarks,now,threshold=.4,{
  maxOcclusionMs:420,
  lengthTolerance:.46
}={}){
  if(!Array.isArray(landmarks) || !tracker){
    return {landmarks,recovered:0,rejected:0};
  }
  const result=landmarks.slice();
  let recovered=0,rejected=0;
  for(const chain of CHAINS){
    const memory=tracker.chains.get(chain.name);
    const a=result[chain.a],b=result[chain.b],c=result[chain.c];
    const endsVisible=visible(a,threshold)&&visible(c,threshold);
    const middleVisible=visible(b,threshold);
    if(!endsVisible)continue;
    let usable=middleVisible;
    if(usable){
      const l1=mag(sub(xyz(b),xyz(a))),l2=mag(sub(xyz(c),xyz(b)));
      usable=l1>1e-4&&l2>1e-4;
      if(usable&&memory.lengths){
        const [old1,old2]=memory.lengths;
        const isPlausible=(v,old)=>Math.abs(v-old)<=lengthTolerance*old;
        usable=isPlausible(l1,old1)&&isPlausible(l2,old2);
      }
      if(usable){
        memory.lengths=memory.lengths?
          [memory.lengths[0]*.92+l1*.08,memory.lengths[1]*.92+l2*.08]:
          [l1,l2];
        memory.reference=xyz(b);
        memory.lastSeen=now;
        continue;
      }
      rejected++;
    }
    if(memory.lengths&&memory.reference&&now-memory.lastSeen>=0&&
        now-memory.lastSeen<=maxOcclusionMs){
      const estimated=reconstructMiddle(a,c,{
        x:memory.reference[0],y:memory.reference[1],z:memory.reference[2]
      },...memory.lengths);
      if(estimated){
        result[chain.b]={...b,...estimated,visibility:threshold,presence:threshold,
          inferred:true};
        recovered++;
        continue;
      }
    }
    // Mark an inconsistent middle joint as missing. Never let an obvious
    // bogus elbow/knee create a sudden, catastrophic twist in the GLB.
    if(middleVisible){
      result[chain.b]={...b,visibility:0,presence:0};
    }
  }
  tracker.recovered=recovered;tracker.rejected=rejected;
  return {landmarks:result,recovered,rejected};
}
