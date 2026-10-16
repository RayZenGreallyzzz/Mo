// MediaPipe runs off the UI/render thread. Process only the newest transferred frame;
// the main thread never queues frames while a detection is in flight.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

let pose = null;
self.onmessage = async ({data}) => {
  if (data.type === 'init') {
    try {
      const fileset = await FilesetResolver.forVisionTasks(data.wasmUrl);
      pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {modelAssetPath:data.modelUrl, delegate:'CPU'},
        runningMode:'VIDEO',
        numPoses:1,
        minPoseDetectionConfidence:.45,
        minPosePresenceConfidence:.45,
        minTrackingConfidence:.45
      });
      self.postMessage({type:'ready'});
    } catch (error) {
      self.postMessage({type:'error', stage:'init', message:String(error?.message || error)});
    }
    return;
  }
  if (data.type !== 'detect') return;
  const bitmap = data.bitmap;
  try {
    if (!pose) throw new Error('MediaPipe не инициализирован');
    const start = performance.now();
    const result = pose.detectForVideo(bitmap, data.timestamp);
    const inferenceMs = performance.now() - start;
    self.postMessage({
      type:'result', result, inferenceMs, capturedAt:data.capturedAt,
      generation:data.generation
    });
  } catch (error) {
    self.postMessage({
      type:'error', stage:'detect', message:String(error?.message || error),
      generation:data.generation
    });
  } finally {
    bitmap?.close?.();
  }
};
