# Test models

`selfie_segmentation.tflite` is the general selfie segmentation model from the `@mediapipe/selfie_segmentation` npm package (Apache 2.0, Google). It only stands in for the multiclass clothes model in `outfit_test.mjs`, so the outfit pipeline can be tested without network access; it outputs a single person mask instead of a clothes mask.
