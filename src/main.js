import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// HTML5 motion-capture prototype. Source videos never leave the browser.
// The simple fixed-proportion Mixamo-named 22-joint mannequin is NOT a generic
// retargeter for the user's own model; exported GLB is a motion source for later retargeting.
const $ = id => document.getElementById(id);
const MODEL_URL = new URL('/pose_landmarker_lite.task', location.origin).href;
// Pose model and MediaPipe WASM are served locally inside the APK or from the hosted site.
const WASM_URL = new URL('/wasm/', location.origin).href.replace(/\/$/, '');
const trackedNames = [
 'mixamorigSpine1','mixamorigSpine2','mixamorigNeck','mixamorigHead',
 'mixamorigLeftArm','mixamorigLeftForeArm','mixamorigRightArm','mixamorigRightForeArm'
];
const state = {mode:'camera',stream:null,blobURL:null,source:false,pose:null,
 processing:false,recording:false,reviewMode:false,frames:[],startTime:0,recordedDuration:0,
 playback:false,playbackStart:0,lastInfer:0,lastVideoTime:-1,
 lastCapture:0,smoothed:0.45,visibility:0.4,demoStart:0,lastResult:null};
let toastTimer;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
function status(message){$('source-status').textContent=message;}
function showEngine(message,ok=false){$('engine-chip').textContent=(ok?'✓ ':'● ')+message;$('engine-chip').style.color=ok?'#6cf0bd':'#f5d895';}
function setControls(){
 const usable=state.source && (state.mode==='demo'||!!state.pose);
 $('record').disabled=!usable||state.recording||state.playback;
 $('finish').disabled=!state.recording;
 $('play-capture').disabled=state.recording||state.frames.length<2;
 $('clear').disabled=state.recording||!state.frames.length;
 $('export-json').disabled=state.recording||state.frames.length<2;
 $('export-glb').disabled=state.recording||state.frames.length<2;
 $('record').classList.toggle('recording',state.recording);
 $('play-capture').textContent=state.playback?'Ⅱ Пауза':'▶ Просмотр';
 $('start-camera').hidden=state.mode!=='camera';
 $('choose-video').hidden=state.mode!=='video';
 $('start-demo').hidden=state.mode!=='demo';
 $('timeline').disabled=state.frames.length<2||state.recording;
 $('frame-count').textContent=`${state.frames.length} ключевых кадров`;
 $('rec-label').hidden=!state.recording;
}
const scene=new THREE.Scene();scene.background=new THREE.Color('#0b1524');
const camera=new THREE.PerspectiveCamera(37,1,0.01,100);
const stage=$('model-stage');
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.4));
renderer.setClearColor('#0b1524');renderer.outputColorSpace=THREE.SRGBColorSpace;
stage.append(renderer.domElement);
const orbit=new OrbitControls(camera,renderer.domElement);
orbit.enableDamping=true;orbit.dampingFactor=.07;orbit.minDistance=1.5;orbit.maxDistance=10;
function resetView(){camera.position.set(2.6,1.8,4.8);orbit.target.set(0,1.45,0);orbit.update();}
resetView();$('reset-view').addEventListener('click',resetView);
scene.add(new THREE.HemisphereLight(0x9cd8ff,0x131831,2.0));
const keyLight=new THREE.DirectionalLight(0xb6f5ff,3);keyLight.position.set(3,5,4);scene.add(keyLight);
const fill=new THREE.DirectionalLight(0x9164ff,1.8);fill.position.set(-3,2,-3);scene.add(fill);
const floorGrid=new THREE.GridHelper(10,30,0x246078,0x17344f);floorGrid.position.y=.02;scene.add(floorGrid);
const floor=new THREE.Mesh(new THREE.CircleGeometry(1.0,40),new THREE.MeshBasicMaterial({color:0x163a55,transparent:true,opacity:.30}));
floor.rotation.x=-Math.PI/2;floor.position.y=.014;scene.add(floor);

// A *real* SkinnedMesh makes GLBImporter/AnimationStudio recognize the
// Mixamo-named THREE.Bones after GLB export, unlike plain node groups.
const specs=[
 ['Hips',null,[0,1.07,0]],
 ['Spine','Hips',[0,.18,0]],['Spine1','Spine',[0,.17,0]],['Spine2','Spine1',[0,.20,0]],
 ['Neck','Spine2',[0,.20,0]],['Head','Neck',[0,.16,0]],['HeadTop_End','Head',[0,.19,0]],
 ['LeftShoulder','Spine2',[.19,.06,0]],['LeftArm','LeftShoulder',[.14,0,0]],
 ['LeftForeArm','LeftArm',[.30,0,0]],['LeftHand','LeftForeArm',[.26,0,0]],
 ['RightShoulder','Spine2',[-.19,.06,0]],['RightArm','RightShoulder',[-.14,0,0]],
 ['RightForeArm','RightArm',[-.30,0,0]],['RightHand','RightForeArm',[-.26,0,0]],
 ['LeftUpLeg','Hips',[.13,-.08,0]],['LeftLeg','LeftUpLeg',[0,-.44,0]],
 ['LeftFoot','LeftLeg',[0,-.43,0]],['LeftToeBase','LeftFoot',[0,-.075,.14]],
 ['RightUpLeg','Hips',[-.13,-.08,0]],['RightLeg','RightUpLeg',[0,-.44,0]],
 ['RightFoot','RightLeg',[0,-.43,0]],['RightToeBase','RightFoot',[0,-.075,.14]]
];
const rigRoot=new THREE.Group();rigRoot.name='MoCap_Mixamo_UpperBody';scene.add(rigRoot);
const joints={};const bones=[];
for(const [part,parent,offset] of specs){
 const b=new THREE.Bone();b.name='mixamorig'+part;b.position.fromArray(offset);
 if(parent)joints[parent].add(b);else rigRoot.add(b);
 joints[part]=b;bones.push(b);
}
rigRoot.updateMatrixWorld(true);
const boneIndex=new Map(bones.map((b,i)=>[b.name,i]));
const meshPositions=[],meshNormals=[],meshColors=[],skinIndices=[],skinWeights=[];
function addPartGeometry(geometry,matrix,bone,color){
 const g=geometry.index?geometry.toNonIndexed():geometry.clone();
 g.applyMatrix4(matrix);
 const pos=g.getAttribute('position'),nor=g.getAttribute('normal');
 const c=new THREE.Color(color);const index=boneIndex.get(bone.name);
 for(let i=0;i<pos.count;i++){
  meshPositions.push(pos.getX(i),pos.getY(i),pos.getZ(i));
  meshNormals.push(nor.getX(i),nor.getY(i),nor.getZ(i));
  meshColors.push(c.r,c.g,c.b);
  skinIndices.push(index,0,0,0);skinWeights.push(1,0,0,0);
 }
 g.dispose();geometry.dispose();
}
const tempA=new THREE.Vector3(),tempB=new THREE.Vector3();
for(const [part,parent] of specs){
 const bone=joints[part];bone.getWorldPosition(tempA);
 const children=bone.children.filter(c=>c.isBone);
 for(const child of children){
  child.getWorldPosition(tempB);
  const length=tempA.distanceTo(tempB);
  if(length<.025)continue;
  const isLeg=/Leg|Foot/.test(part),isArm=/Arm|Shoulder/.test(part);
  const rad = isLeg ? .085 : isArm ? .069 : /Spine|Hips/.test(part) ? .14 : .074;
  const geom=new THREE.CylinderGeometry(rad*.90,rad,length,10,1);
  const quat=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),tempB.clone().sub(tempA).normalize());
  const transform=new THREE.Matrix4().compose(tempA.clone().add(tempB).multiplyScalar(.5),quat,new THREE.Vector3(1,1,1));
  const color=isArm?0x54c6e6:isLeg?0x536d9e:part==='Head'?0xb597f5:0x637ba8;
  addPartGeometry(geom,transform,bone,color);
 }
 const rad = part==='Head' ? .135 : /Shoulder|UpLeg|Hips/.test(part) ? .094 : .071;
 const sphere=new THREE.SphereGeometry(rad,12,9);
 const transform=new THREE.Matrix4().makeTranslation(tempA.x,tempA.y,tempA.z);
 addPartGeometry(sphere,transform,bone,part==='Head'?0xcfa9ff:0x84ddf2);
}
const skelGeom=new THREE.BufferGeometry();
skelGeom.setAttribute('position',new THREE.Float32BufferAttribute(meshPositions,3));
skelGeom.setAttribute('normal',new THREE.Float32BufferAttribute(meshNormals,3));
skelGeom.setAttribute('color',new THREE.Float32BufferAttribute(meshColors,3));
skelGeom.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndices,4));
skelGeom.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeights,4));
skelGeom.computeBoundingSphere();
const skinned=new THREE.SkinnedMesh(skelGeom,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45,metalness:.24,side:THREE.DoubleSide}));
skinned.name='MoCap_Skin';skinned.frustumCulled=false;rigRoot.add(skinned);
rigRoot.updateMatrixWorld(true);
skinned.bind(new THREE.Skeleton(bones));
const rest=new Map(bones.map(b=>[b.name,b.quaternion.clone()]));
const neutral=()=>{for(const b of bones)b.quaternion.copy(rest.get(b.name));rigRoot.updateMatrixWorld(true);};
const workingQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),tempV=new THREE.Vector3();
function orientBone(bone,relativeDirection,smoothing){
 if(!relativeDirection||relativeDirection.lengthSq()<1e-6)return;
 bone.parent.getWorldQuaternion(parentQ);
 tempV.copy(relativeDirection).normalize().applyQuaternion(parentQ.invert());
 const reference=bone.children.find(c=>c.isBone)?.position;
 if(!reference||reference.lengthSq()<1e-7)return;
 workingQ.setFromUnitVectors(reference.clone().normalize(),tempV.normalize());
 bone.quaternion.slerp(workingQ,Math.min(1,Math.max(.05,smoothing)));
 rigRoot.updateMatrixWorld(true);
}
const LM={nose:0,leftEar:7,rightEar:8,leftShoulder:11,rightShoulder:12,leftElbow:13,rightElbow:14,leftWrist:15,rightWrist:16,leftHip:23,rightHip:24};
function valid(landmarks,index){const l=landmarks?.[index];return l&&Number.isFinite(l.x)&&Number.isFinite(l.y)&&Number.isFinite(l.z)&& (l.visibility??1)>=state.visibility;}
function point(l){return new THREE.Vector3(l.x,-l.y,-l.z);}
function dir(lm,a,b){return valid(lm,a)&&valid(lm,b)?point(lm[b]).sub(point(lm[a])):null;}
function mid(lm,a,b){return point(lm[a]).add(point(lm[b])).multiplyScalar(.5);}
function applyPose(data){
 const landmarks=data?.worldLandmarks?.[0]||data?.landmarks?.[0];
 if(!landmarks)return false;
 const visual=data?.landmarks?.[0];
 if(!(valid(landmarks,11)&&valid(landmarks,12)&&valid(landmarks,13)&&valid(landmarks,14)))return false;
 const strength=1-state.smoothed*.88;
 const sh=mid(landmarks,11,12);
 if(valid(landmarks,23)&&valid(landmarks,24)){
  const torso=sh.sub(mid(landmarks,23,24));
  // Upper-body only: pelvis and both legs are never modified.
  orientBone(joints.Spine1,torso,strength*.37);
  orientBone(joints.Spine2,torso,strength*.24);
 }
 for(const [side,s,e,w] of [['Left',11,13,15],['Right',12,14,16]]){
  const upper=dir(landmarks,s,e);
  if(upper)orientBone(joints[side+'Arm'],upper,strength);
  const lower=dir(landmarks,e,w);
  if(lower)orientBone(joints[side+'ForeArm'],lower,strength);
 }
 if(valid(landmarks,0)&&valid(landmarks,11)&&valid(landmarks,12)){
  const head=point(landmarks[0]).sub(mid(landmarks,11,12));
  orientBone(joints.Neck,head,strength*.3);
 }
 state.lastResult=visual?data:state.lastResult;
 return true;
}
function applyDemo(time){
 neutral();
 const wave=Math.sin(time*5.4),swing=Math.sin(time*2.6);
 joints.LeftArm.quaternion.setFromEuler(new THREE.Euler(0,-.08,-.55-.34*wave));
 joints.LeftForeArm.quaternion.setFromEuler(new THREE.Euler(0,0,-.75-.25*Math.sin(time*5.4+.6)));
 joints.RightArm.quaternion.setFromEuler(new THREE.Euler(0,.06,.25+.19*swing));
 joints.RightForeArm.quaternion.setFromEuler(new THREE.Euler(0,0,.72+.12*swing));
 joints.Spine2.quaternion.setFromEuler(new THREE.Euler(.035*Math.sin(time*1.5),0,.085*Math.sin(time*1.7)));
 joints.Neck.quaternion.setFromEuler(new THREE.Euler(0,.12*Math.sin(time*2),0));
 rigRoot.updateMatrixWorld(true);
}
function snapshot(seconds){
 if(state.frames.length>=2700){stopRecording();toast('Достигнут лимит записи: 3 минуты');return;}
 const rotations={};
 for(const name of trackedNames){rotations[name]=joints[name.slice(9)].quaternion.toArray();}
 const t=Math.max(0,seconds);
 if(state.frames.length&&t<=state.frames.at(-1).t)return;
 state.frames.push({t,rotations});
 state.recordedDuration=t;
 $('timer').textContent=formatTime(t);
 $('frame-count').textContent=state.frames.length+' ключевых кадров';
}
function formatTime(s){const m=Math.floor(s/60),sec=Math.floor(s%60),tenths=Math.floor((s%1)*10);return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${tenths}`;}
function startRecording(){
 if(!state.source)return toast('Сначала включи камеру, видео или демо');
 state.playback=false;state.reviewMode=false;state.frames=[];state.recordedDuration=0;
 state.recording=true;state.startTime=performance.now();state.lastCapture=-1;
 if(state.mode==='video'&&$('video').paused){$('video').play().catch(()=>{});}
 snapshot(0);setControls();$('timer').textContent='00:00.0';$('timeline-label').textContent='Идёт запись…';
 toast('Запись началась — двигай руками!');
}
function stopRecording(){
 state.recording=false;state.reviewMode=true;state.recordedDuration=state.frames.at(-1)?.t||0;
 $('timeline').value='0';$('timeline-label').textContent='Длительность '+formatTime(state.recordedDuration);
 setControls();
 toast(state.frames.length>1?`Сохранено ${state.frames.length} кадров — можно смотреть и экспортировать`:'Движение не обнаружено. Попробуй ещё раз.');
}
$('record').addEventListener('click',startRecording);
$('finish').addEventListener('click',stopRecording);
$('clear').addEventListener('click',()=>{state.playback=false;state.reviewMode=false;state.frames=[];state.recordedDuration=0;$('timer').textContent='00:00.0';$('timeline-label').textContent='Нет записи';$('timeline').value='0';neutral();setControls();toast('Запись очищена');});
$('play-capture').addEventListener('click',()=>{
 if(state.frames.length<2)return;
 state.playback=!state.playback;
 if(state.playback){const offset=Number($('timeline').value)/100*state.recordedDuration;state.playbackStart=performance.now()-offset*1000;}
 setControls();
});
$('timeline').addEventListener('input',()=>{
 if(state.frames.length<2)return;
 state.playback=false;
 const time=Number($('timeline').value)/100*state.recordedDuration;
 applyRecorded(time);$('timer').textContent=formatTime(time);setControls();
});
function applyRecorded(time){
 if(!state.frames.length)return;
 let hi=state.frames.findIndex(f=>f.t>=time);if(hi<0)hi=state.frames.length-1;
 const upper=state.frames[hi],lower=state.frames[Math.max(0,hi-1)];
 const alpha=upper.t>lower.t?(time-lower.t)/(upper.t-lower.t):0;
 for(const name of trackedNames){
  const bone=joints[name.slice(9)];
  const q0=new THREE.Quaternion().fromArray(lower.rotations[name]);
  const q1=new THREE.Quaternion().fromArray(upper.rotations[name]);
  bone.quaternion.copy(q0).slerp(q1,Math.max(0,Math.min(1,alpha)));
 }
 rigRoot.updateMatrixWorld(true);
}
async function downloadBlob(blob,filename){
  if(Capacitor.isNativePlatform()){
    // Store in Android app cache and hand the file to a selected app via ACTION_SEND.
    // No blanket storage permission and no private media upload.
    const base64=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onerror=()=>reject(reader.error);
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.readAsDataURL(blob);
    });
    await Filesystem.writeFile({path:filename,data:base64,directory:Directory.Cache});
    const {uri}=await Filesystem.getUri({path:filename,directory:Directory.Cache});
    await Share.share({title:'Сохранить '+filename,text:'Экспорт MoCap Studio',url:uri,dialogTitle:'Сохранить или отправить файл'});
    return;
  }
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}
const safeName=()=>String($('clip-name').value||'Motion').trim().replace(/[^\p{L}\p{N}_-]+/gu,'_').slice(0,50)||'Motion';
$('export-json').addEventListener('click',async()=>{
 if(state.frames.length<2)return;
 const pack={format:'MoCapStudio-upperbody-v1',fps:30,duration:state.recordedDuration,
 source:state.mode,scope:'upper-body-only',model:'fixed Mixamo-named demo mannequin',
 notes:'Root and legs are fixed. Keys contain LOCAL bone quaternions. No raw video is included.',
 bones:trackedNames,frames:state.frames};
 try{await downloadBlob(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),safeName()+'_MoCap.json');toast('JSON подготовлен для сохранения');}catch(e){toast('Не удалось сохранить JSON: '+(e?.message||e));}
});
function makeClip(){
 const start=state.frames[0]?.t||0;
 const times=state.frames.map(f=>Math.max(0,f.t-start));
 const tracks=trackedNames.map(name=>new THREE.QuaternionKeyframeTrack(joints[name.slice(9)].uuid+'.quaternion',times,
  state.frames.flatMap(f=>f.rotations[name])));
 return new THREE.AnimationClip(safeName(),-1,tracks);
}
$('export-glb').addEventListener('click',async()=>{
 if(state.recording||state.frames.length<2)return;
 const button=$('export-glb');button.disabled=true;button.textContent='◌ Создаём GLB…';
 const save=trackedNames.map(name=>joints[name.slice(9)].quaternion.clone());
 try{
  // Export in bind pose. AnimationClip contains all captured local rotations.
  neutral();const exporter=new GLTFExporter();
  const glb=await exporter.parseAsync(rigRoot,{binary:true,trs:true,animations:[makeClip()],onlyVisible:false});
  if(!(glb instanceof ArrayBuffer))throw Error('Экспорт вернул не бинарный GLB');
  const data=new DataView(glb);if(data.getUint32(0,true)!==0x46546c67)throw Error('Неверная сигнатура GLB');
  await downloadBlob(new Blob([glb],{type:'model/gltf-binary'}),safeName()+'_MoCap.glb');
  toast('GLB сохранён. Проверь импорт в Animation Studio.');
 }catch(e){console.error(e);toast('Не удалось экспортировать GLB: '+(e?.message||e));}
 finally{trackedNames.forEach((name,i)=>joints[name.slice(9)].quaternion.copy(save[i]));rigRoot.updateMatrixWorld(true);button.textContent='↓ Экспорт GLB';setControls();}
});

// Draw landmark overlay correctly even when the source video is letterboxed.
const video=$('video'),overlay=$('landmark-canvas'),ctx=overlay.getContext('2d');
const pairs=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[0,11],[0,12]];
function renderLandmarks(pose){
 const rect=$('video-stage').getBoundingClientRect(),w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
 if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h;}
 ctx.clearRect(0,0,w,h);
 const points=pose?.landmarks?.[0];if(!points||!video.videoWidth)return;
 const scale=Math.min(w/video.videoWidth,h/video.videoHeight);
 const rw=video.videoWidth*scale,rh=video.videoHeight*scale,ox=(w-rw)/2,oy=(h-rh)/2;
 function pos(i){const p=points[i];return [ox+p.x*rw,oy+p.y*rh];}
 ctx.lineWidth=Math.max(2,Math.min(4,w/200));ctx.strokeStyle='#60ecf6';ctx.shadowBlur=9;ctx.shadowColor='#00e8e4';
 for(const [a,b] of pairs){
  if(!valid(points,a)||!valid(points,b))continue;
  const p=pos(a),q=pos(b);ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();
 }
 ctx.shadowBlur=0;
 for(const i of [0,11,12,13,14,15,16,23,24]){
  if(!valid(points,i))continue;const p=pos(i);ctx.beginPath();ctx.arc(...p,i===15||i===16?5:4,0,Math.PI*2);ctx.fillStyle='#b6ffff';ctx.fill();
 }
}
async function ensureLandmarker(){
 if(state.pose)return state.pose;
 showEngine('Загрузка MediaPipe и модели…');
 try{
  const { FilesetResolver,PoseLandmarker }=await import('@mediapipe/tasks-vision');
  const vision=await FilesetResolver.forVisionTasks(WASM_URL);
  state.pose=await PoseLandmarker.createFromOptions(vision,{
   baseOptions:{modelAssetPath:MODEL_URL,delegate:'CPU'},runningMode:'VIDEO',
   numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45
  });
  showEngine('MediaPipe готов · локальное распознавание',true);return state.pose;
 }catch(e){showEngine('Не удалось загрузить MediaPipe');
  throw new Error('Ошибка локальной модели MediaPipe: '+(e?.message||e));}
}
async function stopSource({keepPose=false}={}){
 state.source=false;state.lastVideoTime=-1;state.lastInfer=0;
 if(state.recording)stopRecording();
 state.playback=false;state.reviewMode=false;
 if(state.stream){for(const t of state.stream.getTracks())t.stop();state.stream=null;}
 video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
 if(state.blobURL)URL.revokeObjectURL(state.blobURL);state.blobURL=null;
 $('video-layer').style.display='none';$('video-placeholder').style.display='flex';
 ctx.clearRect(0,0,overlay.width,overlay.height);
 $('pose-label').textContent='НЕТ СКЕЛЕТА';status('Ожидание');neutral();setControls();
 if(!keepPose)toast('Источник остановлен');
}
$('stop-source').addEventListener('click',()=>stopSource());
function showVideo(){
 $('video-layer').style.display='block';$('video-placeholder').style.display='none';
 $('video-layer').classList.toggle('no-mirror',!$('mirror').checked);
}
$('mirror').addEventListener('change',()=>{$('video-layer').classList.toggle('no-mirror',!$('mirror').checked);});
$('smooth').addEventListener('input',()=>{state.smoothed=Number($('smooth').value)/100;$('smooth-value').textContent=$('smooth').value+'%';});
$('confidence').addEventListener('input',()=>{state.visibility=Number($('confidence').value)/100;$('confidence-value').textContent=$('confidence').value+'%';});
async function startCamera(){
 if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){toast('Нужен установленный APK либо сайт HTTPS. В режиме content:// камера запрещена.');status('Нет разрешённого доступа к камере');return;}
 await stopSource({keepPose:true});
 status('Подключаем камеру…');
 try{
  state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}});
  video.srcObject=state.stream;video.muted=true;video.loop=false;video.controls=false;await video.play();
  showVideo();status('Готовим распознавание…');
  await ensureLandmarker();state.source=true;status('Камера активна');setControls();toast('Камера готова. Покажи руки и плечи.');
 }catch(e){await stopSource({keepPose:true});status('Ошибка камеры');const m=e?.name==='NotAllowedError'||e?.name==='PermissionDeniedError'?'Android запретил доступ к камере. Разреши камеру для MoCap Studio в настройках приложения и попробуй снова.':e?.name==='NotFoundError'?'На устройстве не найдена доступная камера.':(e?.message||String(e));toast(m);}
}
$('start-camera').addEventListener('click',startCamera);
$('choose-video').addEventListener('click',()=>$('video-input').click());
$('video-input').addEventListener('change',async event=>{
 const file=event.target.files?.[0];if(!file)return;
 await stopSource({keepPose:true});
 state.blobURL=URL.createObjectURL(file);video.src=state.blobURL;video.muted=true;video.loop=false;video.controls=true;
 try{
  await video.play();showVideo();status('Готовим распознавание…');
  await ensureLandmarker();video.currentTime=0;await video.play();state.source=true;status('Видео активно');setControls();toast('Видеофайл загружен. Можно начать запись.');
 }catch(e){status('Ошибка видео');toast(e?.message||String(e));await stopSource({keepPose:true});}
 finally{event.target.value='';}
});
$('start-demo').addEventListener('click',async()=>{
 await stopSource({keepPose:true});state.source=true;state.demoStart=performance.now();
 $('video-placeholder').style.display='flex';$('video-placeholder').querySelector('strong').textContent='Демо: махание рукой';
 $('video-placeholder').querySelector('p').textContent='3D-манекен двигается без камеры. Нажми «Начать запись», затем «Завершить» и экспортируй GLB.';
 $('pose-label').textContent='ДЕМО-ДВИЖЕНИЕ';status('Демо активно');setControls();toast('Демо запущено — можно записать движение.');
});
for(const tab of document.querySelectorAll('.mode'))tab.addEventListener('click',async()=>{
 const next=tab.dataset.mode;if(next===state.mode)return;
 await stopSource({keepPose:true});state.mode=next;
 document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b===tab));
 $('video-placeholder').querySelector('strong').textContent=next==='camera'?'Твоя камера — студия захвата':next==='video'?'Загрузи готовый ролик':'Проверь анимацию без камеры';
 $('video-placeholder').querySelector('p').textContent=next==='camera'?'Встань лицом к камере так, чтобы были видны оба плеча, локти и кисти.':next==='video'?'Поддерживаются видеоформаты, которые умеет воспроизводить браузер.':'Нажми «Запустить демо» для проверки захвата и экспорта.';
 $('source-note').textContent=next==='demo'?'Демо работает полностью локально — без интернета и камеры.':next==='video'?'Видео обрабатывается в браузере. Никакой отправки ролика на сервер нет.':'Камера работает внутри APK или на HTTPS-сайте. Распознавание происходит на устройстве.';
 setControls();
});
function infer(now){
 if(!state.pose||!state.source||video.readyState<2||video.paused||state.playback)return;
 if(now-state.lastInfer<100||state.lastVideoTime===video.currentTime)return;
 state.lastInfer=now;state.lastVideoTime=video.currentTime;
 try{
  const result=state.pose.detectForVideo(video,now);
  const found=applyPose(result);renderLandmarks(result);
  $('pose-label').textContent=found?'● СКЕЛЕТ НАЙДЕН':'○ ПОКАЖИ ПЛЕЧИ И ЛОКТИ';
  $('live-status').innerHTML='<span class="green-dot"></span> '+(found?'ДВИЖЕНИЕ':'ОЖИДАНИЕ');
  if(state.recording&&found&&now-state.lastCapture>=64){snapshot((now-state.startTime)/1000);state.lastCapture=now;}
 }catch(e){console.warn('Pose detection issue:',e);status('Ошибка кадра распознавания');}
}
const timer=new THREE.Clock();
function animate(){
 requestAnimationFrame(animate);
 const dt=Math.min(.1,timer.getDelta()),now=performance.now();
 if(state.playback&&state.frames.length>1){
  const seconds=(now-state.playbackStart)/1000;
  const time=state.recordedDuration>0?seconds%state.recordedDuration:0;
  applyRecorded(time);$('timer').textContent=formatTime(time);
  $('timeline').value=String(Math.round(time/state.recordedDuration*100)||0);
 }else if(state.reviewMode){
  // Do not let the live camera/demo override the recorded pose while reviewing.
 }else if(state.source&&state.mode==='demo'){
  if(!state.recording || now-state.lastCapture>=64){
   applyDemo((now-state.demoStart)/1000);
   if(state.recording){snapshot((now-state.startTime)/1000);state.lastCapture=now;}
  }
 }else if(state.source){infer(now);}
 orbit.update();
 const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
 if(renderer.domElement.width!==Math.round(w*renderer.getPixelRatio())||renderer.domElement.height!==Math.round(h*renderer.getPixelRatio())){
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
 }
 renderer.render(scene,camera);
}
neutral();setControls();animate();
showEngine('Демо готово. Для камеры нужна загрузка MediaPipe.');