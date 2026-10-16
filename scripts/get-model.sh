#!/usr/bin/env bash
set -euo pipefail
mkdir -p public
curl -fLSs --retry 4 --connect-timeout 15 --max-time 120 \
 "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task" \
 -o public/pose_landmarker_lite.task
[ "$(wc -c < public/pose_landmarker_lite.task)" -gt 1000000 ]
echo "Загружена локальная модель MediaPipe Pose Lite"
