import * as esbuild from 'esbuild';
import fs from 'node:fs';
const minify = !process.argv.includes('--dev');
const r = await esbuild.build({
  entryPoints: ['src/main.js'], bundle: true, format: 'esm', write: false, minify, target: ['chrome100', 'firefox100', 'safari16'],
  external: ['three', '@mediapipe/tasks-vision'], legalComments: 'none',
});
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/index.html', 'utf8');
const map = (three, mp) => `<script type="importmap">${JSON.stringify({ imports: { three, '@mediapipe/tasks-vision': mp } })}</script>`;
const page = (im) => tpl.replace('<!--IMPORTMAP-->', im).replace('<!--APP-->', () => `<script type="module">\n${js}\n</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('public/index.html', page(map('./vendor/three.module.min.js', './vendor/tasks-vision/vision_bundle.mjs')));
const cdnMap = map('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js', 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs');
const cdnFlag = `<script>window.PR_ASSETS = 'cdn';</script>`;
fs.writeFileSync('dist/index.html', page(cdnFlag + '\n' + cdnMap));
// Unbundled hosted variant: index.html + src/*.js as native ES modules
fs.rmSync('deploy', { recursive: true, force: true });
fs.mkdirSync('deploy/src', { recursive: true });
for (const f of fs.readdirSync('src')) if (f.endsWith('.js')) fs.copyFileSync('src/' + f, 'deploy/src/' + f);
fs.writeFileSync('deploy/index.html', tpl.replace('<!--IMPORTMAP-->', cdnFlag + '\n' + cdnMap).replace('<!--APP-->', '<script type="module" src="./src/main.js"></script>'));
console.log('built', (js.length / 1024).toFixed(1) + 'KB js', minify ? 'minified' : 'dev');
