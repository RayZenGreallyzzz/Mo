import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const from='node_modules/@mediapipe/tasks-vision/wasm';
if(!existsSync(from))throw Error('Не найдена установленная папка MediaPipe wasm');
mkdirSync('public/wasm',{recursive:true});
for(const filename of readdirSync(from)){
 if(!/\.(wasm|js|mjs)$/.test(filename))continue;
 const source=join(from,filename);
 if(statSync(source).isFile())cpSync(source,join('public/wasm',filename));
}
if(!existsSync('public/pose_landmarker_lite.task'))throw Error('Не загружена модель MediaPipe. Выполни scripts/get-model.sh');
console.log('MediaPipe offline assets ready');
