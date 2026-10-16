import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const main=readFileSync('src/main.js','utf8');
const html=readFileSync('index.html','utf8');
test('character selection and export with animation are connected',()=>{
 assert.ok(html.includes('id="character-file"'));
 assert.ok(html.includes('id="load-character"'));
 assert.ok(main.includes('new GLTFLoader().loadAsync'));
 assert.ok(main.includes('state.character?.model||rigRoot'));
 assert.ok(main.includes('state.frames.flatMap(f=>f.targetRotations?.[pair.sourceName]'));
 assert.ok(main.includes('retargetTrack(pair,f.rotations[pair.sourceName])'));
 assert.ok(main.includes('node.isSkinnedMesh'));
});
test('pose capture is not hard-capped to 10 fps and smoothing defaults low',()=>{
 assert.ok(!main.includes('now-state.lastInfer<100'));
 assert.ok(main.includes('state.inferCost'));
 assert.ok(main.includes("options('GPU')"));
 assert.ok(main.includes("options('CPU')"));
 assert.match(html,/id="smooth"[^>]*value="12"/);
});
