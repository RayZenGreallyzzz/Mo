import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegStability,resetLegStability,classifyLegActivity} from '../src/leg-stability.js';

const standing=()=>({LeftUpLeg:[.03,-1,0],LeftLeg:[0,-1,0],
  RightUpLeg:[-.03,-1,0],RightLeg:[0,-1,0]});
test('standing posture calibrates both independent legs and filters camera jitter',()=>{
 const s=createLegStability();
 assert.equal(classifyLegActivity(s,standing()).calibrated,true);
 const jitter={LeftUpLeg:[.12,-.99,0],LeftLeg:[.09,-1,0],
   RightUpLeg:[-.12,-1,0],RightLeg:[-.08,-1,0]};
 const result=classifyLegActivity(s,jitter);
 assert.equal(result.lockLeft,true);assert.equal(result.lockRight,true);
});
test('lifting only the left knee does not move the right support leg',()=>{
 const s=createLegStability();
 classifyLegActivity(s,standing());
 const result=classifyLegActivity(s,{...standing(),
   LeftUpLeg:[.2,-.5,.9],LeftLeg:[.2,-.9,.1],
   RightUpLeg:[.08,-.99,.04],RightLeg:[-.05,-1,.01]});
 assert.equal(result.activeLeft,true);
 assert.equal(result.lockRight,true);
});
test('lifting only the right leg does not move the left support leg',()=>{
 const s=createLegStability();
 classifyLegActivity(s,standing());
 const result=classifyLegActivity(s,{...standing(),
   RightUpLeg:[-.2,-.6,-.8],RightLeg:[-.1,-.6,.8],
   LeftUpLeg:[.05,-1,.03]});
 assert.equal(result.activeRight,true);
 assert.equal(result.lockLeft,true);
});
test('squat can still bend both thighs and shins',()=>{
 const s=createLegStability();
 classifyLegActivity(s,standing());
 const both=classifyLegActivity(s,{...standing(),
   LeftUpLeg:[.5,-.7,.5],RightUpLeg:[-.5,-.7,.5],
   LeftLeg:[0,-.65,-.76],RightLeg:[0,-.65,-.76]});
 assert.equal(both.activeLeft,true);
 assert.equal(both.activeRight,true);
});
test('single leg cannot be driven before a safe two-legged standing baseline',()=>{
 const s=createLegStability();
 const bad={...standing(),LeftUpLeg:[0,.2,1]};
 assert.equal(classifyLegActivity(s,bad).calibrated,false);
 assert.equal(s.reference,null);
 classifyLegActivity(s,standing());
 assert.ok(s.reference);
 resetLegStability(s);
 assert.equal(s.reference,null);
});
test('missing shin landmarks cannot invent leg lift on either side',()=>{
 const s=createLegStability();
 classifyLegActivity(s,standing());
 const missing={...standing(),LeftLeg:undefined,RightLeg:undefined};
 const result=classifyLegActivity(s,missing);
 assert.equal(result.lockLeft,true);
 assert.equal(result.lockRight,true);
});
