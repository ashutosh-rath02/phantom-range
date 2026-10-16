# Phantom Range

A webcam AR shooting range. Make a finger gun at your laptop camera and a pistol, carbine, pump shotgun or bolt-action sniper rifle appears in your hand, with recoil, ejecting brass, muzzle flash and stereo sound that follows your hand. Everything runs in the browser; the camera feed never leaves your machine.

## Run it

Pick whichever is easiest:

1. **Hosted link**: open https://phantom-range.vercel.app in Chrome or Edge, click *Enter free range*, allow the camera.
2. **Single file**: open `phantom-range.html` (same as `dist/index.html`) in Chrome or Edge by double-clicking it. Chrome and Edge allow the webcam on local files. It loads three.js and the MediaPipe engine from jsDelivr and the hand model from Google's model bucket, so you need to be online the first time.
3. **Fully offline**: serve the `public/` folder, which bundles the engine and model locally:
   ```bash
   cd public && python3 -m http.server 8000
   # then open http://localhost:8000
   ```

Firefox and Safari work best through option 1 or 3 (they are stricter about cameras on `file://` pages).

## Hand signals

| Signal | Gesture |
| --- | --- |
| Aim | Finger gun: index finger out, thumb up, other fingers curled. Move your hand to steer; tilting the finger swings the aim a little. Two-finger guns work too. |
| Fire | Snap your thumb down onto your index finger. Every snap fires, even a lazy one from a low thumb; lift the thumb a little to cock again. On the carbine, hold the thumb down for full auto. |
| Reload | Point the gun straight at the ceiling for a moment. An empty gun also reloads on its own. |
| Switch weapon | Hold an open palm until the ring fills. Keep holding to cycle pistol → carbine → shotgun → sniper. |
| Fire mode | Hold a fist (carbine only): auto → 3-round burst → semi. |
| Scope | With the sniper, hold your aim still for half a second. Move quickly to drop out of the scope. |
| Change outfit | Hold a rock sign (index and little finger up, middle and ring curled) until the ring fills. Each hold moves to the next outfit: woodland, desert, urban digital, night ops, range officer, arctic, then back to your own clothes. |

Both hands can hold a gun at once (akimbo). The first time you draw, hold still for a moment: that locks your aim to the screen center. Press **C** to re-center any time.

Keyboard and mouse also work: `Space` fire · `R` reload · `Q` or `1`–`4` weapons · `B` fire mode · `E` scope · `O` outfit · `C` re-center · `H` legend · `D` tracking skeleton · `M` mute · `F` fullscreen · `Esc` settings. With no webcam, choose *Play with the mouse*.

## Tips for good tracking

- Stand about 1 to 2 m from the laptop so your hand and shoulders are in frame.
- Light your front (face a window or lamp). Back-lighting makes hands hard to see.
- If aiming feels too slow or too twitchy, open Settings and change *Aim sensitivity*. If the trigger fires too easily or not at all, change *Trigger* between Light / Normal / Firm.
- The trigger follows your thumb as you play, so it keeps working when your thumb rests lower after a while. If it still fires too easily or misses snaps, change *Trigger* in Settings.
- The tracking rate is shown at the top right. On laptops where the GPU is busy drawing the game, Phantom Range tries the CPU for tracking a few seconds into the first session and keeps whichever is faster (remembered for that browser).
- Turn on *Show tracking skeleton* (or press `D`) to see exactly what the tracker sees, including the live thumb value, the fire line and your learned cocked and fired levels.

## Outfits

The outfit button (top right), the `O` key, the rock sign and the *Outfit* menu in Settings all change what you wear on screen. Your clothes are found with MediaPipe's multiclass selfie segmenter, which separates clothes from skin, hair and background, and redrawn in the chosen pattern with the folds and shading of the real fabric kept. The model (16 MB) downloads the first time you pick an outfit and runs in its own worker at a few frames per second, so it never slows the trigger down. Like the hand tracker, it runs entirely in the browser.

## Modes

- **Free range**: endless. Steel plates ring and swing, bottles shatter and respawn, clay pigeons fly across, and a drone shows up now and then.
- **60-second drill**: score attack with a combo multiplier (up to ×4 for consecutive hits). Your best score is saved in the browser.

## How it works

- `src/tracker.js` runs MediaPipe Hand Landmarker (GPU, falling back to CPU) in a Web Worker, so inference never stalls rendering. GPU inference shares the GPU with the game's rendering and can slow to a few frames per second on some laptops, so when tracking is slow the CPU delegate gets a short trial in a second worker and the faster one stays. Each new camera frame goes to the worker as an ImageBitmap the moment it arrives; if a browser cannot run the worker, tracking falls back to the main thread. Landmarks are mapped from the mirrored, cover-fitted video onto the screen.
- `src/hands.js` tracks hands across frames, smooths them with One Euro filters and recognizes poses from 3D finger extension, backed by a 2D check in the camera image (a relaxed index finger that the 3D estimate reads as bent still counts while its tip reaches well past the other fingers). The trigger (`ThumbTrigger`) reads how high the thumb tip sits above the index finger, blending the 3D estimate with a measurement in the camera image. It fires on a quick drop measured from where the thumb just was and re-cocks as soon as the thumb comes back up part of the way, so it does not depend on a fixed cocked height that a tired thumb stops reaching. A drop seen on a single frame fires if it is deep (common at low camera rates); a shallower one has to show on the next frame too, so one bad landmark cannot fire the gun. The trigger is tested against thumb motion recorded in a live session (`test/data`).
- The gun is placed in real 3D: depth comes from fitting the metric world landmarks to the 2D landmarks, orientation from the index finger and knuckle line. Depth-only spheres and cylinders along the curled fingers hide the grip, so the real fist appears to wrap around it, and the thumb is always drawn on top so you can see your trigger finger. The pistol's hammer follows the thumb.
- Aim is the palm position (measured in meters, so it feels the same at any distance) plus a share of the finger direction, filtered and rewound to just before the thumb started to drop, so the snap does not drag the shot. Between camera frames the crosshair and gun are carried forward a few milliseconds and eased at display rate, so they glide instead of stepping at the camera's frame rate. Rendering resolution steps down automatically if a machine cannot hold a steady frame rate.
- Every sound is synthesized at startup with an OfflineAudioContext (layered crack, blast, body, thump and room tail per weapon), then played through a stereo panner and a small range reverb.

## Develop

```bash
npm install
npm run build           # bundles src/ into public/index.html (local vendor files), dist/index.html (single file)
                        # and deploy/ (the hosted site: index.html plus src/*.js as native ES modules)
npm run build:dev       # same, unminified
npm run serve           # static server on http://localhost:8080 (open /public/ or /deploy/)
```

`public/vendor` and `public/models` hold three.js, the MediaPipe wasm engine and `hand_landmarker.task`, so `public/` is a complete static site you can deploy anywhere. The outfit model is not vendored (it is 16 MB); it loads from Google's model bucket, or from `public/models/selfie_multiclass_256x256.tflite` if you put a copy there.

### Deploying

The live site is a Vercel project connected to this repository. Every push to `main` builds with `npm run build` and serves the `deploy/` folder (settings in `vercel.json`); pull requests and other branches get preview deployments.

### Tests

`test/` drives the real app in headless Chromium with a scripted fake webcam made from real hand photos (finger gun, thumb dropped, pointing up, open palm, fist):

```bash
npm test                            # fast unit tests: pose classification and the thumb trigger
npm run serve &                     # static server for the repo, needed by the browser tests below
cd test
node gesture_unit.mjs               # pose classification on 50 real hand landmark sets
node trigger_unit.mjs               # thumb trigger: full, shallow and camera-facing snaps, drift, noise, glitches
node trigger_replay.mjs             # thumb trigger against a recorded live session (test/data)
node tracker_trial.mjs              # GPU against CPU tracking trial, with mocked workers
node outfit_test.mjs                # outfit pipeline in the browser (a small person model stands in for the clothes model)
node worker_soak.mjs                # tracking worker: steady rate, no backlog, stable memory
./regress.sh                        # gestures, tutorial, gameplay, single-file build
```

## Credits

- Hand tracking: [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (Apache 2.0).
- Outfits: [MediaPipe Image Segmenter](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter) with the multiclass selfie model (Apache 2.0).
- 3D: [three.js](https://threejs.org) (MIT).
- Test photos in `test/img`: gesture samples from [HaGRID](https://github.com/hukenovs/hagrid) (CC BY-SA 4.0) and [MediaPipe samples](https://github.com/google-ai-edge/mediapipe-samples) (Apache 2.0). They are only used by the tests; the legend pictograms are drawn from landmark coordinates measured on them.
- Guns, targets, effects and sounds are procedural and made for this project.
