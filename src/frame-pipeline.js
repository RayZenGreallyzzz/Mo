// Portable scheduling policy used by the camera renderer and regression tests.
// We deliberately prefer a fresh sample after every inference instead of
// buffering old video frames (which makes live mocap visibly lag).
export function sampleIntervalMs(inferenceMs) {
  const cost=Number.isFinite(inferenceMs)&&inferenceMs>0?inferenceMs:33;
  return Math.max(33,Math.min(140,cost*.95));
}
export function shouldSampleFrame({now,lastInfer,lastVideoTime,videoTime,busy,inferenceMs}) {
  return !busy && videoTime!==lastVideoTime &&
    now-lastInfer>=sampleIntervalMs(inferenceMs);
}
export function shouldApplyResult({generation,currentGeneration,active,playback,review}) {
  return generation===currentGeneration && !!active && !playback && !review;
}
