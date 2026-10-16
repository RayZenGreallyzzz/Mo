import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveDirections} from '../src/tracking.js';
import {shortestHeadingDelta,updateCalibratedHeading,resetHeading}
 from '../src/body-orientation.js';

function subject(shoulderDx=.3,shoulderDz=0){
 const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0,presence:0}));
 const set=(i,x,y,z)=>p[i]={x,y,z,visibility:1,presence:1};
 set(11,.5+shoulderDx/2,.28,shoulderDz/2);
 set(12,.5-shoulderDx/2,.28,-shoulderDz/2);
 set(23,.5+shoulderDx*.35,.67,shoulderDz*.35);
 set(24,.5-shoulderDx*.35,.67,-shoulderDz*.35);
 return {p,set};
}
test('signed shoulder depth yields front, both profiles and 180-degree back turn',()=>{
 for(const [dx,dz,expected] of [[.3,0,0],[0,-.3,Math.PI/2],
    [0,.3,-Math.PI/2],[-.3,0,Math.PI]]){
   const {p}=subject(dx,dz);
   const yaw=deriveDirections(p,.4,1).BodyYaw;
   assert.ok(Math.abs(shortestHeadingDelta(yaw,expected))<1e-5,
     JSON.stringify({dx,dz,yaw,expected}));
 }
});
test('a forward punch does not turn the whole avatar if shoulders stay fixed',()=>{
 const {p,set}=subject(.34,0);
 const initial=deriveDirections(p,.4).BodyYaw;
 set(13,.5,.34,-.50);set(15,.45,.35,-.88);
 const dirs=deriveDirections(p,.4);
 assert.ok(dirs.LeftArm);
 assert.ok(dirs.LeftForeArm);
 assert.equal(dirs.BodyYaw,initial);
});
test('body yaw holds when shoulders and hips are both obscured',()=>{
 const {p}=subject();
 p[11].visibility=.05;p[12].visibility=.05;p[23].visibility=.05;p[24].visibility=.05;
 assert.equal(deriveDirections(p,.4).BodyYaw,undefined);
});
test('shortest yaw avoids a full spin across 180-degree wrap',()=>{
 assert.ok(Math.abs(shortestHeadingDelta(-3.12,3.12))<.05);
 const state={reference:null,offset:0};
 updateCalibratedHeading(state,0);
 for(let i=0;i<20;i++)updateCalibratedHeading(state,Math.PI/2);
 assert.ok(Math.abs(state.offset-Math.PI/2)<.01);
 updateCalibratedHeading(state,3.12);
 const nearBack=state.offset;
 updateCalibratedHeading(state,-3.12);
 assert.ok(Math.abs(shortestHeadingDelta(state.offset,nearBack))<.5);
 resetHeading(state);assert.equal(state.offset,0);assert.equal(state.reference,null);
});
