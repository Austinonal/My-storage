# Bundled models

- `selfie_segmenter.tflite`: MediaPipe selfie segmenter (float16, 256 x 256), Apache-2.0, from
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
  (sha256 191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b). Used by `src/segment.ts`.

The Whisper model for auto captions is not bundled: `src/speech.worker.ts` downloads `Xenova/whisper-base` from the
Hugging Face hub on first use and the browser keeps it cached.
