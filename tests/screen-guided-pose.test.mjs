import test from 'node:test';
import assert from 'node:assert/strict';
import {fuseProjectedSegment,mergeScreenGuidedDirections,isFrontFacingPose}
 from '../src/screen-guided-pose.js';
const angle=(a,b)=>Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]);
const pose=(leftX=.66,rightX=.34)=>{const p=Array.from({length:33},()=>({x:0,y:0,visibility:0,presence:0}));p[11]={x:leftX,y:.35,visibility:1,presence:1};p[12]={x:rightX,y:.35,visibility:1,presence:1};return p;};
test('left raised arm stays vertically raised even when world Z wrongly dominates',()=>{
 const screen=[.018,.28,-.1]; // BLUE overlay visibly straight up
 const world=[.09,.15,.79];  // depth hallucination points forward
 const got=fuseProjectedSegment(screen,world,{aspect:4/3});
 assert.ok(got[1]>0);
 assert.ok(got[1]/Math.hypot(...got)>.91,'screen up angle is not swallowed by Z');
 assert.ok(Math.abs(angle(got,screen.map((v,i)=>i===0?v*4/3:v)))<1e-8);
});
test('a genuinely foreshortened forward punch keeps its real depth',()=>{
 const got=fuseProjectedSegment([.01,.01,-.48],[.06,0,-.62]);
 assert.ok(got[2]<-1,'strong depth preserved with tiny screen segment');
});
test('a left-only motion cannot invent movement in RIGHT arm or legs',()=>{
 const a=mergeScreenGuidedDirections({LeftArm:[0,.1,.6],RightArm:[-1,0,0],BodyYaw:0},
    {LeftArm:[0,.35,0]}, {frontFacing:true});
 assert.ok(a.LeftArm[1]>.99);
 assert.deepEqual(a.RightArm,[-1,0,0]);
 assert.equal(a.LeftUpLeg,undefined);
 assert.equal(a.BodyYaw,0);
});
test('no visible screen direction falls back to actual world data',()=>{
 const world={LeftArm:[0,.1,.6],LeftForeArm:[0,0,-.3]};
 const got=mergeScreenGuidedDirections(world,{LeftArm:[NaN,1,0]},{frontFacing:true});
 assert.deepEqual(got,world);
});
test('side and back turns must not use the front-facing screen constraint',()=>{
 const p=pose();
 assert.equal(isFrontFacingPose(p,0,0),true);
 assert.equal(isFrontFacingPose(p,1.2,0),false);
 assert.equal(isFrontFacingPose(p,-1.2,0),false);
 assert.equal(isFrontFacingPose(p,0,1.5),false);
 assert.equal(isFrontFacingPose(pose(.48,.47),0,0),false);
 assert.equal(isFrontFacingPose(pose(.34,.66),0,0),false);
 const raw={LeftArm:[0,0,-1]};
 assert.deepEqual(mergeScreenGuidedDirections(raw,{LeftArm:[0,1,0]},{frontFacing:false}),raw);
});
test('follows independent directions for left/right arms and knees',()=>{
 const world={LeftArm:[.1,.01,.8],RightArm:[-.2,.08,-.5],LeftLeg:[0,-1,0],
  RightLeg:[0,-1,0],Head:[.2,.15,.1]};
 const screen={LeftArm:[.02,.24,0],RightArm:[-.18,-.01,0],LeftLeg:[.2,-.22,0],
  RightLeg:[-.19,-.21,0]};
 const dirs=mergeScreenGuidedDirections(world,screen,{frontFacing:true});
 assert.ok(dirs.LeftArm[1]>0&&dirs.RightArm[0]<0);
 assert.ok(dirs.LeftLeg[0]>0&&dirs.RightLeg[0]<0);
 assert.deepEqual(dirs.Head,world.Head);
});
test('app applies projection correction to preview and imported GLB independently',async()=>{
 const fs=await import('node:fs');
 const main=fs.readFileSync('src/main.js','utf8');
 assert.ok(main.includes('mergeScreenGuidedDirections(worldDirs,screenDirs'));
 assert.ok(main.includes('const dirs=screenDirs?{...screenDirs}:guidedWorld'));
 assert.ok(main.includes('syncCharacter(state.character?guidedWorld:dirs)'));
 assert.ok(main.includes('isFrontFacingPose(imageLandmarks,worldDirs.BodyYaw'));
});
