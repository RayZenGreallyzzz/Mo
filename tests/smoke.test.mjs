import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync('src/main.js','utf8');
const html=readFileSync('index.html','utf8');
const manifest=readFileSync('scripts/camera-manifest.py','utf8');
test('camera uses browser getUserMedia in secure app origin',()=>{
 assert.match(js,/navigator\.mediaDevices\.getUserMedia/);
 assert.match(js,/window\.isSecureContext/);
 assert.match(manifest,/android\.permission\.CAMERA/);
});
test('offline MediaPipe, 3D preview, GLB export and Android share exist',()=>{
 assert.match(js,/\@mediapipe\/tasks-vision/);
 assert.ok(!js.includes('cdn.jsdelivr.net'));
 assert.match(js,/new GLTFExporter/);
 assert.match(js,/Share.share/);
 assert.match(js,/startRecording/);
 assert.match(html,/id="start-camera"/);
});
