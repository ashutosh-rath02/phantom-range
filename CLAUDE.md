# Phantom Range

Webcam AR shooting range: MediaPipe hand tracking puts a gun in the player's hand and gestures run it.

## Workflow

- This repository (github.com/ashutosh-rath02/phantom-range) is the single source of truth. Make every change here, commit it, and push to `main`. Do not deploy local folders or inline files to Vercel.
- The live site is https://phantom-range.vercel.app, Vercel project `phantom-range` in team `lucif3rins-projects`. Vercel builds from this repo (`npm ci`, `npm run build`) and serves `deploy/`, as set in `vercel.json`. If a push does not deploy on its own, deploy that commit from GitHub (git source) rather than uploading files.
- Writing style for anything user-facing (UI text, README, commit messages): clean and professional, no emojis, no double dashes.

## Layout

- `src/`: all game code. `main.js` (loop, modes, HUD), `tracker.js` (webcam, tracking worker), `hands.js` (gestures, thumb trigger), `weapons.js`, `models.js`, `range.js`, `audio.js`, `hud.js`, `fx.js`, `config.js` (all tunables), `index.html` (page template).
- `build.mjs` writes three builds: `public/` (offline, vendored engine and model), `dist/index.html` (single file) and `deploy/` (hosted, git-ignored). `public/index.html` and `dist/index.html` are committed, so run `npm run build` after changing `src/` and commit the outputs with it.

## Checks before pushing

- `npm test` runs the fast unit tests (pose classification, thumb trigger simulation).
- Browser tests: `npm run serve` in the background, then `bash test/regress.sh` (headless Chromium with a fake webcam built from real hand photos). It is slow on small cloud machines; the scenario runner starts its clock only once tracking is running.
