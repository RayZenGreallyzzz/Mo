import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildRetargetMap, retargetPose, retargetTrack, clampJointQuaternion } from './character.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { deriveDirections, trackingSign } from './tracking.js';
import { shouldSampleFrame, shouldApplyResult } from './frame-pipeline.js';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// HTML5 motion-capture prototype. Source videos never leave the browser.
// The simple fixed-proportion Mixamo-named 22-joint mannequin is NOT a generic
// retargeter for the user's own model; exported GLB is a motion source for later retargeting.
const $ = id => document.getElementById(id);
const MoCapCamera = registerPlugin('MoCapCamera');
const MODEL_URL = new URL('/pose_landmarker_lite.task', location.origin).href;
// Pose model and MediaPipe WASM are served locally inside the APK or from the hosted site.
const WASM_URL = new URL('/wasm/', location.origin).href.replace(/\/$/, '');
const trackedNames = [
 'mixamorigHips','mixamorigSpine1','mixamorigSpine2','mixamorigNeck','mixamorigHead',
 'mixamorigLeftShoulder','mixamorigLeftArm','mixamorigLeftForeArm','mixamorigLeftHand',
 'mixamorigRightShoulder','mixamorigRightArm','mixamorigRightForeArm','mixamorigRightHand',
 'mixamorigLeftUpLeg','mixamorigLeftLeg','mixamorigLeftFoot',
 'mixamorigRightUpLeg','mixamorigRightLeg','mixamorigRightFoot'
];
const state = {mode:'camera',stream:null,blobURL:null,source:false,pose:null,
 processing:false,recording:false,reviewMode:false,frames:[],startTime:0,recordedDuration:0,
 playback:false,playbackStart:0,lastInfer:0,lastVideoTime:-1,
 lastCapture:0,smoothed:0.12,visibility:0.4,demoStart:0,lastResult:null,worldXSign:1,handednessReady:false,
 character:null,loadingCharacter:false,inferCost:0,delegate:'',lastRender:0,slowFrames:0,sourceGeneration:0,frameAge:0};
let poseWorker=null,workerReady=false,workerBusy=false,workerDisabled=false,workerTimer=null;
const boneLastSeen=new Map();
function relaxStaleBones(now=performance.now()){
 for(const name of trackedNames){
  const bone=joints[name.slice(9)];
  if(bone && now-(boneLastSeen.get(name)||0)>700)
   bone.quaternion.slerp(rest.get(bone.name),.12);
 }
}
let toastTimer;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
function status(message){$('source-status').textContent=message;}
function showEngine(message,ok=false){$('engine-chip').textContent=(ok?'✓ ':'● ')+message;$('engine-chip').style.color=ok?'#6cf0bd':'#f5d895';}
function setControls(){
 const usable=state.source && (state.mode==='demo'||workerReady||!!state.pose);
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
 $('load-character').disabled=state.loadingCharacter||state.recording;
 $('reset-character').disabled=!state.character||state.loadingCharacter||state.recording;
}
const scene=new THREE.Scene();scene.background=new THREE.Color('#0b1524');
const camera=new THREE.PerspectiveCamera(37,1,0.01,100);
const stage=$('model-stage');
const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'low-power'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.0)); // Save tablet GPU for live pose detection
renderer.setClearColor('#0b1524');renderer.outputColorSpace=THREE.SRGBColorSpace;
stage.append(renderer.domElement);
const orbit=new OrbitControls(camera,renderer.domElement);
orbit.enableDamping=true;orbit.dampingFactor=.07;orbit.minDistance=1.5;orbit.maxDistance=10;
function resetView(){camera.position.set(0,1.7,4.6);orbit.target.set(0,1.45,0);orbit.update();}
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

// Keep the original tracking mannequin as a source skeleton. A user-supplied
// GLB is a separate SkinnedMesh target, never overwritten by camera tracking.
function syncCharacter(){
 if(!state.character)return;
 for(const pair of state.character.mapping){
  const src=joints[pair.sourceName.slice(9)];
  if(src)pair.target.quaternion.copy(retargetPose(pair,src.quaternion));
 }
 state.character.model.updateMatrixWorld(true);
}
function resetCustomPose(){
 if(!state.character)return;
 for(const pair of state.character.mapping)pair.target.quaternion.copy(pair.targetRest);
 state.character.model.updateMatrixWorld(true);
}
function detachCharacter(){
 if(!state.character)return;
 const {model}=state.character;scene.remove(model);
 model.traverse(node=>{
  node.geometry?.dispose?.();
  for(const m of Array.isArray(node.material)?node.material:[node.material]){
   if(!m)continue;
   for(const value of Object.values(m))if(value?.isTexture)value.dispose();
   m.dispose?.();
  }
 });
 state.character=null;rigRoot.visible=true;
 $('character-name').textContent='Стандартный манекен';
 $('character-status').textContent='Можешь загрузить свой GLB с готовым скелетом.';
 setControls();
}
$('load-character').addEventListener('click',()=>$('character-file').click());
$('reset-character').addEventListener('click',()=>{
 if(state.frames.length>1&&!window.confirm('Вернуться к манекену? Старая запись будет очищена.'))return;
 state.playback=false;state.reviewMode=false;state.frames=[];
 detachCharacter();neutral();resetView();setControls();toast('Стандартный манекен восстановлен');
});
$('character-file').addEventListener('change',async event=>{
 const file=event.target.files?.[0];event.target.value='';if(!file)return;
 if(state.recording||state.loadingCharacter)return;
 if(file.size>90*1024*1024)return toast('GLB больше 90 МБ. Для планшета сначала оптимизируй модель.');
 if(state.frames.length>1&&!window.confirm('Загрузить нового персонажа? Текущая запись будет очищена.'))return;
 state.loadingCharacter=true;setControls();$('character-status').textContent='Загружаем GLB и ищем скелет…';
 let url;try{
  url=URL.createObjectURL(file);
  const result=await new GLTFLoader().loadAsync(url);
  const model=new THREE.Group();model.name='MoCap_Imported_Character';model.add(result.scene);
  let hasSkin=false;result.scene.traverse(node=>{if(node.isSkinnedMesh)hasSkin=true;});
  if(!hasSkin)throw Error('GLB не содержит привязанный скелет (SkinnedMesh). Добавь скелет и AutoSkin в Animation Studio.');
  const map=buildRetargetMap(bones,result.scene);
  if(map.length<8||!map.some(pair=>pair.sourceName==='mixamorigLeftLeg'||pair.sourceName==='mixamorigRightLeg'))
   throw Error('Нужен GLB с настоящим гуманоидным скелетом: распознано '+map.length+' костей. Сначала привяжи модель в Animation Studio.');
  const bounds=new THREE.Box3().setFromObject(result.scene);
  if(bounds.isEmpty())throw Error('В GLB нет видимой 3D-геометрии');
  const height=bounds.max.y-bounds.min.y;
  if(!Number.isFinite(height)||height<1e-6)throw Error('Некорректный масштаб персонажа');
  const k=2.1/height;model.scale.setScalar(k);
  const center=bounds.getCenter(new THREE.Vector3());
  model.position.set(-center.x*k,-bounds.min.y*k,-center.z*k);
  // Compute the retarget bind-basis from the neutral mannequin, even if
  // the camera was already moving when this GLB was opened.
  model.updateMatrixWorld(true);
  const sourcePose=bones.map(b=>b.quaternion.clone());
  neutral();
  let remap;
  try{remap=buildRetargetMap(bones,result.scene);}
  finally{bones.forEach((b,i)=>b.quaternion.copy(sourcePose[i]));rigRoot.updateMatrixWorld(true);}
  detachCharacter();
  scene.add(model);rigRoot.visible=false;
  state.character={model,mapping:remap,name:file.name};
  state.playback=false;state.reviewMode=false;state.frames=[];state.recordedDuration=0;
  $('timeline').value='0';$('timer').textContent='00:00.0';$('timeline-label').textContent='Нет записи';
  $('character-name').textContent=file.name;
  $('character-status').textContent='✓ GLB загружен · '+remap.length+' совпадающих костей. Можно записывать движение.';
  syncCharacter();resetView();toast('Персонаж загружен! '+remap.length+' суставов управляются захватом.');
 }catch(e){
  console.warn('GLB model import:',e);
  $('character-status').textContent='Не удалось загрузить GLB: '+(e?.message||e);
  toast('GLB: '+(e?.message||e));
 }finally{if(url)URL.revokeObjectURL(url);state.loadingCharacter=false;setControls();}
});
const workingQ=new THREE.Quaternion(),parentQ=new THREE.Quaternion(),tempV=new THREE.Vector3();
function orientBone(bone,relativeDirection,smoothing){
 if(!relativeDirection||relativeDirection.lengthSq()<1e-6)return;
 // Update only the parent chain instead of recalculating the whole skeleton
 // once for every arm, knee and finger. This is important on Android.
 bone.parent.updateWorldMatrix(true,false);
 bone.parent.getWorldQuaternion(parentQ);
 tempV.copy(relativeDirection).normalize().applyQuaternion(parentQ.invert());
 // Terminal hand bones have no child in the minimal Mixamo mannequin.
 // Still rotate them from wrist → hand landmark for GLB retargeting.
 const reference=bone.children.find(c=>c.isBone)?.position ||
   (bone.name.endsWith('LeftHand')?new THREE.Vector3(1,0,0):
    bone.name.endsWith('RightHand')?new THREE.Vector3(-1,0,0):null);
 if(!reference||reference.lengthSq()<1e-7)return;
 workingQ.setFromUnitVectors(reference.clone().normalize(),tempV.normalize());
// Bad landmarks must never force a joint into a dangerous 180-degree pose.
 const safe=clampJointQuaternion(bone.name,rest.get(bone.name),workingQ);
 bone.quaternion.slerp(safe,Math.min(1,Math.max(.05,smoothing)));
}
// MediaPipe's semantic LEFT and RIGHT landmark indexes are never swapped.
// The checkbox is presentation only (CSS); it never changes these coordinates.
// If a camera's world coordinate handedness differs, one stable sign is estimated
// from left/right shoulders, once per source, to match the mannequin bind pose.
function valid(landmarks,index){
 const l=landmarks?.[index];
 return Boolean(l && Number.isFinite(l.x) && Number.isFinite(l.y) &&
   Number.isFinite(l.z) && (l.visibility??1)>=state.visibility &&
   (l.presence??1)>=state.visibility);
}
const mpPoint = l=>new THREE.Vector3(l[0],l[1],l[2]);
function applyPose(data){
 const landmarks=data?.worldLandmarks?.[0]||data?.landmarks?.[0];
 if(!landmarks){
  relaxStaleBones();rigRoot.updateMatrixWorld(true);syncCharacter();
  return false;
 }
 if(!state.handednessReady){
  const sign=trackingSign(landmarks,state.visibility);
  if(sign){state.worldXSign=sign;state.handednessReady=true;}
 }
 const dirs=deriveDirections(landmarks,state.visibility,state.worldXSign);
 const strength=Math.max(.23,1-state.smoothed*.75); // 12% default: less visual lag
 let changed=false;
 const move=(name,scale=1)=>{
  const target=dirs[name];
  if(!target||!joints[name])return;
  boneLastSeen.set(name,performance.now());
  orientBone(joints[name],mpPoint(target),strength*scale);changed=true;
 };
 // The body follows pelvis and shoulders; arms and legs use their OWN
 // independent source landmarks. An occluded limb holds its own last pose.
 move('Hips',.65);
 move('Spine1',.72);
 move('Spine2',.75);
 move('LeftShoulder',.8);
 move('RightShoulder',.8);
 for(const side of ['Left','Right']){
  move(side+'Arm');move(side+'ForeArm');move(side+'Hand',.88);
  move(side+'UpLeg');move(side+'Leg');move(side+'Foot',.84);
 }
 move('Neck',.78);
 // Independent head tilt/yaw using ears, eyes and nose. Missing landmarks
 // never pull the opposite arm or leg into the same pose.
 const head=dirs.Head;
 if(head){
  const target=new THREE.Euler(head[0],head[1],head[2],'XYZ');
  workingQ.setFromEuler(target);
  joints.Head.quaternion.slerp(
   clampJointQuaternion('Head',rest.get(joints.Head.name),workingQ),
   Math.min(1,strength*.9));
  boneLastSeen.set('Head',performance.now());
  changed=true;
 }
 relaxStaleBones();
 rigRoot.updateMatrixWorld(true);
 syncCharacter();
 state.lastResult=data?.landmarks?.length?data:state.lastResult;
 return changed;
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
 joints.LeftUpLeg.quaternion.setFromEuler(new THREE.Euler(.18*Math.sin(time*2.6),0,0));
 joints.RightUpLeg.quaternion.setFromEuler(new THREE.Euler(-.18*Math.sin(time*2.6),0,0));
 joints.LeftLeg.quaternion.setFromEuler(new THREE.Euler(-.12*Math.max(0,Math.sin(time*2.6)),0,0));
 joints.RightLeg.quaternion.setFromEuler(new THREE.Euler(-.12*Math.max(0,-Math.sin(time*2.6)),0,0));
 rigRoot.updateMatrixWorld(true);syncCharacter();
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
 toast('Запись началась — двигай руками, ногами и головой!');
}
function stopRecording(){
 state.recording=false;state.reviewMode=true;state.recordedDuration=state.frames.at(-1)?.t||0;
 $('timeline').value='0';$('timeline-label').textContent='Длительность '+formatTime(state.recordedDuration);
 setControls();
 toast(state.frames.length>1?`Сохранено ${state.frames.length} кадров — можно смотреть и экспортировать`:'Движение не обнаружено. Попробуй ещё раз.');
}
$('record').addEventListener('click',startRecording);
$('finish').addEventListener('click',stopRecording);
$('clear').addEventListener('click',()=>{state.playback=false;state.reviewMode=false;state.frames=[];state.recordedDuration=0;$('timer').textContent='00:00.0';$('timeline-label').textContent='Нет записи';$('timeline').value='0'; neutral();syncCharacter();setControls();toast('Запись очищена');});
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
 rigRoot.updateMatrixWorld(true);syncCharacter();
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
 const pack={format:'MoCapStudio-fullbody-v2',fps:30,duration:state.recordedDuration,
 source:state.mode,scope:'full-body',model:state.character?.name||'Mixamo-named demo mannequin',
 notes:'Full-body local bone rotations; no global translation/root motion, finger capture or raw video included.',
 bones:trackedNames,frames:state.frames};
 try{await downloadBlob(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'}),safeName()+'_MoCap.json');toast('JSON подготовлен для сохранения');}catch(e){toast('Не удалось сохранить JSON: '+(e?.message||e));}
});
function makeClip(){
 const start=state.frames[0]?.t||0;
 const times=state.frames.map(f=>Math.max(0,f.t-start));
 const tracks=state.character
   ?state.character.mapping.filter(pair=>trackedNames.includes(pair.sourceName))
     .map(pair=>new THREE.QuaternionKeyframeTrack(pair.target.uuid+'.quaternion',times,
       state.frames.flatMap(f=>retargetTrack(pair,f.rotations[pair.sourceName]))))
   :trackedNames.map(name=>new THREE.QuaternionKeyframeTrack(joints[name.slice(9)].uuid+'.quaternion',times,
       state.frames.flatMap(f=>f.rotations[name])));
 return new THREE.AnimationClip(safeName(),-1,tracks);
}
$('export-glb').addEventListener('click',async()=>{
 if(state.recording||state.frames.length<2)return;
 const button=$('export-glb');button.disabled=true;button.textContent='◌ Создаём GLB…';
 const save=trackedNames.map(name=>joints[name.slice(9)].quaternion.clone());
 try{
  // Export in bind pose. AnimationClip contains all captured local rotations.
  neutral();resetCustomPose();const exporter=new GLTFExporter();
  const glb=await exporter.parseAsync(state.character?.model||rigRoot,{binary:true,trs:true,animations:[makeClip()],onlyVisible:false});
  if(!(glb instanceof ArrayBuffer))throw Error('Экспорт вернул не бинарный GLB');
  const data=new DataView(glb);if(data.getUint32(0,true)!==0x46546c67)throw Error('Неверная сигнатура GLB');
  await downloadBlob(new Blob([glb],{type:'model/gltf-binary'}),safeName()+'_MoCap.glb');
  toast('GLB с анимацией подготовлен. Проверь повторной загрузкой.');
 }catch(e){console.error(e);toast('Не удалось экспортировать GLB: '+(e?.message||e));}
 finally{trackedNames.forEach((name,i)=>joints[name.slice(9)].quaternion.copy(save[i]));rigRoot.updateMatrixWorld(true);syncCharacter();button.textContent='↓ Экспорт GLB';setControls();}
});

// Draw landmark overlay correctly even when the source video is letterboxed.
const video=$('video'),overlay=$('landmark-canvas'),ctx=overlay.getContext('2d');
const pairs=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32],[0,7],[0,8]];
function renderLandmarks(pose){
 const rect=$('video-stage').getBoundingClientRect(),w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
 if(overlay.width!==w||overlay.height!==h){overlay.width=w;overlay.height=h;}
 ctx.clearRect(0,0,w,h);
 const points=pose?.landmarks?.[0];if(!points||!video.videoWidth)return;
 const scale=Math.min(w/video.videoWidth,h/video.videoHeight);
 const rw=video.videoWidth*scale,rh=video.videoHeight*scale,ox=(w-rw)/2,oy=(h-rh)/2;
 function pos(i){const p=points[i];return [ox+p.x*rw,oy+p.y*rh];}
 ctx.lineWidth=Math.max(2,Math.min(4,w/200));ctx.strokeStyle='#60ecf6';ctx.shadowBlur=0;
 for(const [a,b] of pairs){
  if(!valid(points,a)||!valid(points,b))continue;
  const p=pos(a),q=pos(b);ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();
 }
 ctx.shadowBlur=0;
 for(const i of [0,7,8,11,12,13,14,15,16,23,24,25,26,27,28,31,32]){
  if(!valid(points,i))continue;const p=pos(i);ctx.beginPath();ctx.arc(...p,i===15||i===16?5:4,0,Math.PI*2);ctx.fillStyle='#b6ffff';ctx.fill();
 }
}
function shutdownWorker(){
  if(workerTimer){clearTimeout(workerTimer);workerTimer=null;}
  poseWorker?.terminate();poseWorker=null;workerReady=false;workerBusy=false;
}
function recoverWorker(reason){
  if(!workerReady)return;
  console.warn('Worker pose failure, trying compatible foreground engine:',reason);
  shutdownWorker();workerDisabled=true;state.processing=false;state.inferCost=0;
  state.lastInfer=0;state.lastVideoTime=-1;
  showEngine('Фоновый захват недоступен · переключаемся');
  ensureLandmarker().then(setControls).catch(error=>{
    status('Ошибка распознавания: '+(error?.message||error));
  });
}
async function ensureLandmarker(){
  if(workerReady||state.pose)return true;
  showEngine('Загружаем локальную модель захвата…');
  // Prefer a CPU Web Worker: synchronous MediaPipe cannot pause the UI or
  // 3D renderer. Older Android WebViews fall back to the previous path.
  if(!workerDisabled&&typeof Worker!=='undefined'&&typeof createImageBitmap==='function'){
    let candidate;
    try{
      candidate=new Worker(new URL('./pose-worker.js',import.meta.url),{type:'module'});
      await new Promise((resolve,reject)=>{
        let done=false;
        const timeout=setTimeout(()=>{done=true;reject(new Error('Фоновая модель не ответила'))},12000);
        const finish=(error)=>{
          if(done)return;
          done=true;clearTimeout(timeout);
          if(error)reject(error);else resolve();
        };
        candidate.onmessage=({data})=>{
          if(data?.type==='ready')finish();
          else if(data?.type==='error')finish(new Error(data.message||'Worker error'));
        };
        candidate.onerror=e=>finish(new Error(e.message||'Worker initialization error'));
        candidate.postMessage({type:'init',wasmUrl:WASM_URL,modelUrl:MODEL_URL});
      });
      poseWorker=candidate;workerReady=true;workerBusy=false;state.delegate='CPU · worker';
      candidate.onmessage=({data})=>{
        if(data?.type==='result'){
          if(workerTimer){clearTimeout(workerTimer);workerTimer=null;}
          workerBusy=false;
          onDetection(data.result,data.inferenceMs,data.capturedAt,data.generation);
        }else if(data?.type==='error')recoverWorker(data.message);
      };
      candidate.onerror=e=>recoverWorker(e.message||'Worker error');
      showEngine('MediaPipe · фоновый поток (3D не блокируется)',true);
      return true;
    }catch(error){
      candidate?.terminate();workerDisabled=true;
      console.warn('Worker not available on this WebView:',error);
    }
  }
  // Compatible fallback, still processing only unique video frames.
  try{
    const {FilesetResolver,PoseLandmarker}=await import('@mediapipe/tasks-vision');
    const vision=await FilesetResolver.forVisionTasks(WASM_URL);
    const options=delegate=>({baseOptions:{modelAssetPath:MODEL_URL,delegate},runningMode:'VIDEO',
      numPoses:1,minPoseDetectionConfidence:.45,minPosePresenceConfidence:.45,minTrackingConfidence:.45});
    try{state.pose=await PoseLandmarker.createFromOptions(vision,options('GPU'));state.delegate='GPU · основной поток';}
    catch(gpuError){
      console.warn('GPU not available, using CPU:',gpuError);
      state.pose=await PoseLandmarker.createFromOptions(vision,options('CPU'));
      state.delegate='CPU · основной поток';
    }
    showEngine('MediaPipe '+state.delegate,true);
    return true;
  }catch(error){
    showEngine('Не удалось загрузить MediaPipe');
    throw new Error('Ошибка локальной модели MediaPipe: '+(error?.message||error));
  }
}
async function stopSource({keepPose=false}={}){
 state.source=false;state.sourceGeneration++;boneLastSeen.clear();state.lastVideoTime=-1;state.lastInfer=0;state.worldXSign=1;state.handednessReady=false;
 if(state.recording)stopRecording();
 state.playback=false;state.reviewMode=false;
 if(state.stream){for(const t of state.stream.getTracks())t.stop();state.stream=null;}
 video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
 if(state.blobURL)URL.revokeObjectURL(state.blobURL);state.blobURL=null;
 $('video-layer').style.display='none';$('video-placeholder').style.display='flex';
 ctx.clearRect(0,0,overlay.width,overlay.height);
 $('pose-label').textContent='НЕТ СКЕЛЕТА';status('Ожидание');neutral();syncCharacter();setControls();
 if(!keepPose)toast('Источник остановлен');
}
$('stop-source').addEventListener('click',()=>stopSource());
function syncMirrorPreview(){
 const mirror=$('mirror').checked;
 $('video-layer').classList.toggle('no-mirror',!mirror);
 // Match the 3D PREVIEW to the selfie mirror without changing any skeleton
 // quaternion, semantic left/right landmark, recorded key or exported GLB.
 stage.classList.toggle('mirrored-preview',mirror&&state.mode!=='demo');
}
function showVideo(){
 $('video-layer').style.display='block';$('video-placeholder').style.display='none';
 syncMirrorPreview();
}
$('mirror').addEventListener('change',syncMirrorPreview);
$('smooth').addEventListener('input',()=>{state.smoothed=Number($('smooth').value)/100;$('smooth-value').textContent=$('smooth').value+'%';});
$('confidence').addEventListener('input',()=>{state.visibility=Number($('confidence').value)/100;$('confidence-value').textContent=$('confidence').value+'%';});
async function startCamera(){
 if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){toast('Нужен установленный APK либо сайт HTTPS. В режиме content:// камера запрещена.');status('Нет разрешённого доступа к камере');return;}
 await stopSource({keepPose:true});
 status('Подключаем камеру…');
 try{
  // Request the Android runtime CAMERA permission before WebView getUserMedia.
  if(Capacitor.isNativePlatform())await MoCapCamera.requestCamera();
  state.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:480},height:{ideal:360},frameRate:{ideal:30,max:30}}});
  video.srcObject=state.stream;video.muted=true;video.loop=false;video.controls=false;await video.play();
  showVideo();status('Готовим распознавание…');
  await ensureLandmarker();state.source=true;status('Камера активна');setControls();toast('Камера готова. Встань в полный рост, чтобы были видны руки, ноги и голова.');
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
 $('video-placeholder').querySelector('p').textContent='3D-персонаж двигается без камеры. Нажми «Начать запись», затем «Завершить» и экспортируй GLB.';
 $('pose-label').textContent='ДЕМО-ДВИЖЕНИЕ';status('Демо активно');setControls();toast('Демо запущено — можно записать движение.');
});
for(const tab of document.querySelectorAll('.mode'))tab.addEventListener('click',async()=>{
 const next=tab.dataset.mode;if(next===state.mode)return;
 await stopSource({keepPose:true});state.mode=next;syncMirrorPreview();
 document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b===tab));
 $('video-placeholder').querySelector('strong').textContent=next==='camera'?'Твоя камера — студия захвата':next==='video'?'Загрузи готовый ролик':'Проверь анимацию без камеры';
 $('video-placeholder').querySelector('p').textContent=next==='camera'?'Встань в полный рост, чтобы были видны руки, ноги и голова.':next==='video'?'Поддерживаются видеоформаты, которые умеет воспроизводить браузер.':'Нажми «Запустить демо» для проверки захвата и экспорта.';
 $('source-note').textContent=next==='demo'?'Демо работает полностью локально — без интернета и камеры.':next==='video'?'Видео обрабатывается в браузере. Никакой отправки ролика на сервер нет.':'Камера работает внутри APK или на HTTPS-сайте. Распознавание происходит на устройстве.';
 setControls();
});
function onDetection(result,cost,capturedAt,generation){
  // A camera or video may have been replaced while an old worker frame
  // was in flight. Never apply stale results or put them into a new clip.
  if(!shouldApplyResult({generation,currentGeneration:state.sourceGeneration,
    active:state.source,playback:state.playback,review:state.reviewMode}))return;
  state.inferCost=state.inferCost?state.inferCost*.8+cost*.2:cost;
  state.frameAge=Math.max(0,performance.now()-capturedAt);
  const found=applyPose(result);
  renderLandmarks(result);
  $('pose-label').textContent=found?'● ТЕЛО ОТСЛЕЖИВАЕТСЯ':'○ ПОКАЖИ ЧАСТИ ТЕЛА В КАМЕРЕ';
  $('live-status').innerHTML='<span class="green-dot"></span> '+(found?'ДВИЖЕНИЕ':'ОЖИДАНИЕ');
  if(state.recording&&found&&capturedAt>=state.startTime&&capturedAt-state.lastCapture>=33){
    snapshot((capturedAt-state.startTime)/1000);state.lastCapture=capturedAt;
  }
  const now=performance.now();
  if(now-(state.lastStatsUpdate||0)>1200){
    $('performance-status').textContent='Распознавание: '+Math.round(state.inferCost)+
      ' мс · задержка обработки ≈'+Math.round(state.frameAge)+' мс · '+state.delegate;
    state.lastStatsUpdate=now;
  }
}
function infer(now){
  if(!(workerReady||state.pose)||!state.source||video.readyState<2||video.paused||state.playback)return;
  // Never accumulate a queue of old camera frames: at most one bitmap is
  // captured/processed at a time, then the next available fresh frame.
  if(!shouldSampleFrame({now,lastInfer:state.lastInfer,lastVideoTime:state.lastVideoTime,
    videoTime:video.currentTime,busy:workerBusy,inferenceMs:state.inferCost}))return;
  state.lastInfer=now;state.lastVideoTime=video.currentTime;
  const generation=state.sourceGeneration;
  if(workerReady&&poseWorker){
    workerBusy=true;
    createImageBitmap(video).then(bitmap=>{
      if(!workerReady||!poseWorker||generation!==state.sourceGeneration||!state.source){
        bitmap.close();workerBusy=false;return;
      }
      try{
        poseWorker.postMessage({type:'detect',bitmap,timestamp:now,capturedAt:now,generation},[bitmap]);
        workerTimer=setTimeout(()=>recoverWorker('Распознавание не отвечает'),2500);
      }catch(error){bitmap.close();workerBusy=false;recoverWorker(error);}
    }).catch(error=>{
      workerBusy=false;
      if(generation===state.sourceGeneration&&state.source)recoverWorker(error);
    });
    return;
  }
  try{
    const began=performance.now();
    const result=state.pose.detectForVideo(video,now);
    onDetection(result,performance.now()-began,began,generation);
  }catch(error){console.warn('Pose detection issue:',error);status('Ошибка кадра распознавания');}
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
 // Render at 30 FPS to leave the GPU budget to live pose recognition.
 if(now-state.lastRender<32)return;
 state.lastRender=now;orbit.update();
 const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
 if(renderer.domElement.width!==Math.round(w*renderer.getPixelRatio())||renderer.domElement.height!==Math.round(h*renderer.getPixelRatio())){
  renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
 }
 renderer.render(scene,camera);
}
neutral();setControls();syncMirrorPreview();animate();
showEngine('Демо готово · полный скелет тела.');
const splash=$('launch-splash');
if(splash)setTimeout(()=>splash.classList.add('loaded'),1850);