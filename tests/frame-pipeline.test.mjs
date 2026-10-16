import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleIntervalMs,shouldSampleFrame,shouldApplyResult} from '../src/frame-pipeline.js';

test('cost-aware budget prevents saturating slow Android cameras',()=>{
  assert.equal(sampleIntervalMs(0),33);
  assert.equal(sampleIntervalMs(20),33);
  assert.equal(sampleIntervalMs(100),95);
  assert.equal(sampleIntervalMs(400),140);
});
test('one worker frame in flight: never queue old video frames',()=>{
  const req={now:2000,lastInfer:1900,lastVideoTime:3.1,videoTime:3.133,
    busy:false,inferenceMs:50};
  assert.equal(shouldSampleFrame(req),true);
  assert.equal(shouldSampleFrame({...req,busy:true}),false);
  assert.equal(shouldSampleFrame({...req,videoTime:req.lastVideoTime}),false);
  assert.equal(shouldSampleFrame({...req,now:1920}),false);
});
test('worker result from previous camera/video generation cannot affect the next source',()=>{
  const req={generation:7,currentGeneration:7,active:true,playback:false,review:false};
  assert.equal(shouldApplyResult(req),true);
  assert.equal(shouldApplyResult({...req,currentGeneration:8}),false);
  assert.equal(shouldApplyResult({...req,active:false}),false);
  assert.equal(shouldApplyResult({...req,playback:true}),false);
  assert.equal(shouldApplyResult({...req,review:true}),false);
});
