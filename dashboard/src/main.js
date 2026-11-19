import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sfx } from './sfx.js';
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { NOISE } from './noise.js';
import { createRain } from './rain.js';
import { createVision } from './vision.js';
import { mapSVG, nmeaLine } from './locate.js';
import { FpsMeter, nextQuality, resolveInitialQuality } from './quality';
import { createCssOrb } from './orbcss';

gsap.registerPlugin(Flip);
gsap.ticker.lagSmoothing(0);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* quality tier (M0-6): full | lite | css. `css` never creates a WebGL context. */
const Q = resolveInitialQuality();
let quality = Q.quality;
const GL = quality !== 'css';
document.getElementById('app').dataset.quality = quality;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- scenarios ---------------- */
const MODES = {
  idle:     { label: 'Idle',      c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .1,  freq: 2.2, swirl: 0,   spread: 0,    ring: 1,   glow: 1,    bloom: .9,  dim: 1 },   place: 'center', s: 1,   status: 'All systems nominal',            sub: 'Standby' },
  listen:   { label: 'Listen',    c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .1,  freq: 1.8, swirl: .1,  spread: .05,  ring: 1.8, glow: 1.1,  bloom: 1,   dim: 1 },   place: 'high',   s: .82, status: 'Listening',                      sub: 'Listening' },
  think:    { label: 'Think',     c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .14, freq: 2.8, swirl: 1,   spread: .12,  ring: 4,   glow: .95,  bloom: .8,  dim: 1 },   place: 'high',   s: .82, status: 'Reasoning',                      sub: 'Thinking' },
  research: { label: 'Research',  c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .12, freq: 2.2, swirl: .35, spread: 0,    ring: 2.5, glow: 1,    bloom: .9,  dim: 1 },   place: 'park',   s: .3,  status: 'Researching · step 3/5',         sub: 'Research' },
  locate:   { label: 'Locate',    c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .1,  freq: 2,   swirl: .25, spread: 0,    ring: 2,   glow: 1,    bloom: .85, dim: 1 },   place: 'park',   s: .3,  status: 'Locating · GPS lock',            sub: 'Locate' },
  vision:   { label: 'Vision',    c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .1,  freq: 2.2, swirl: .2,  spread: 0,    ring: 2.2, glow: 1,    bloom: .85, dim: 1 },   place: 'park',   s: .3,  status: 'Vision · scanning cam-01',       sub: 'Vision' },
  briefing: { label: 'Briefing',  c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .08, freq: 1.4, swirl: .05, spread: 0,    ring: .8,  glow: 1,    bloom: .9,  dim: 1 },   place: 'left',   s: .72, status: 'Morning briefing',               sub: 'Good morning' },
  focus:    { label: 'Focus',     c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'], look: { amp: .04, freq: 1.2, swirl: 0,   spread: -.04, ring: .4,  glow: .8,   bloom: .75, dim: .8 },  place: 'high',   s: .74, status: 'Deep work · notifications held', sub: 'Focus' },
  alert:    { label: 'Alert',     c: '#FF5C77', pal: ['#FF5C77', '#4A0614', '#FF9AAA', '#FF5C77', '#060103'], look: { amp: .13, freq: 3.2, swirl: .2,  spread: .08,  ring: 3,   glow: 1,    bloom: .85, dim: 1 },  place: 'high',   s: .72, status: 'Critical · build failed',        sub: 'Alert' },
  success:  { label: 'Success',   c: '#5EF0A0', pal: ['#5EF0A0', '#05361A', '#A6FFC9', '#5EF0A0', '#010603'], look: { amp: .08, freq: 1.6, swirl: .1,  spread: 0,    ring: 1.5, glow: 1.1,  bloom: 1,   dim: 1 },   place: 'high',   s: .76, status: 'Deploy complete',                sub: 'Deployed' },
  sleep:    { label: 'Sleep',     c: '#5B8CFF', pal: ['#4F86FF', '#081A4A', '#7FA8FF', '#3F6FE0', '#010104'], look: { amp: .03, freq: 1,   swirl: 0,   spread: 0,    ring: .2,  glow: .35,  bloom: .6,  dim: .35 }, place: 'high',   s: .7,  status: 'Night mode',                     sub: 'Good night' }
};

const LEVELS = {
  normal: { label: 'Normal', c: '#4FC3FF', pal: ['#4FB8FF', '#0A2A66', '#8FD0FF', '#2F9BFF', '#010207'] },
  medium: { label: 'Medium', c: '#FFC24A', pal: ['#FFC24A', '#3D2604', '#FFE2A0', '#FFAE1F', '#050302'] },
  high:   { label: 'High',   c: '#B57BFF', pal: ['#B57BFF', '#24105C', '#D8C2FF', '#9B63FF', '#030109'] }
};
const DEFAULT_LVL = { think: 'high', briefing: 'medium' };
const FIXED = { alert: true, success: true };
let level = 'normal';

/* ---------------- WebGL scene ---------------- */
const canvas = $('#gl');
let renderer = GL ? new THREE.WebGLRenderer({ canvas, antialias: quality === 'full', powerPreference: 'high-performance' }) : null;
if (renderer) renderer.setPixelRatio(quality === 'full' ? Math.min(window.devicePixelRatio, 2) : 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(0, 0, 9);

const S = { warp: 0, amp: .07, freq: 1.5, swirl: 0, spread: 0, ring: 1, glow: 1, bloom: .9, dim: 1, audio: 0, burst: 0, x: 0, y: 0, s: 1 };
const P = { rim: new THREE.Color(), deep: new THREE.Color(), part: new THREE.Color(), ring: new THREE.Color(), bg: new THREE.Color() };
const T = { rim: new THREE.Color(), deep: new THREE.Color(), part: new THREE.Color(), ring: new THREE.Color(), bg: new THREE.Color() };
function setPalette(pal, instant) {
  ['rim', 'deep', 'part', 'ring', 'bg'].forEach((k, i) => { T[k].set(pal[i]); if (instant) P[k].copy(T[k]); });
}
setPalette(MODES.idle.pal, true);

const orb = new THREE.Group();
scene.add(orb);

const coreU = { uTime: { value: 0 }, uAmp: { value: .07 }, uFreq: { value: 1.5 }, uColA: { value: P.deep }, uColB: { value: P.rim }, uGlow: { value: 1 } };
const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.92, GL ? 64 : 1), new THREE.ShaderMaterial({
  uniforms: coreU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: NOISE + `
    uniform float uTime,uAmp,uFreq; varying vec3 vN; varying vec3 vV; varying float vNz;
    void main(){
      // two-octave organic rim (same recipe as the AI Studio build)
      float n = snoise(normal*uFreq + uTime*0.65);
      float n2 = snoise(normal*uFreq*2.1 - uTime*0.95)*0.5;
      vNz = n + n2;
      vec3 p = position + normal*(vNz*uAmp*1.6);
      vec4 mv = modelViewMatrix*vec4(p,1.0);
      vV = normalize(-mv.xyz); vN = normalize(normalMatrix*normal);
      gl_Position = projectionMatrix*mv;
    }`,
  fragmentShader: `
    uniform vec3 uColA,uColB; uniform float uGlow; varying vec3 vN; varying vec3 vV; varying float vNz;
    void main(){
      float f = pow(1.0 - max(dot(vN,vV),0.0), 2.3);
      float glow = smoothstep(-0.6, 0.8, vNz);
      float rim = clamp(f + glow*0.45*f, 0.0, 1.0);           // glow lives on the rim only
      vec3 col = mix(uColA*0.2, uColB*0.9, rim);
      col += vec3(0.88,0.96,1.0)*pow(f,5.0)*0.28;               // white-hot edge
      float a = clamp(f*0.72 + glow*0.16*f + 0.02, 0.0, 1.0);    // centre stays nearly clear for the wordmark
      gl_FragColor = vec4(col*uGlow, a);
    }`
}));
orb.add(core);

const cageMat = new THREE.LineBasicMaterial({ color: P.ring, transparent: true, opacity: .035, blending: THREE.AdditiveBlending, depthWrite: false });
const cage = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.12, 2)), cageMat);
orb.add(cage);

const N = !GL ? 0 : quality === 'lite' ? 1500 : reduced ? 2000 : 6500;
const pPos = new Float32Array(N * 3), pSeed = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 1.35 + Math.pow(Math.random(), 2.2) * 1.5, s = Math.sqrt(1 - u * u);
  pPos.set([s * Math.cos(th) * r, u * r * .92, s * Math.sin(th) * r], i * 3);
  pSeed[i] = Math.random();
}
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
const pU = { uTime: { value: 0 }, uSwirl: { value: 0 }, uSpread: { value: 0 }, uPix: { value: renderer ? renderer.getPixelRatio() : 1 }, uColor: { value: P.part }, uK: { value: 1 }, uDim: { value: 1 } };
const particles = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  uniforms: pU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aSeed; uniform float uTime,uSwirl,uSpread,uPix,uK; varying float vA; varying float vS;
    void main(){
      vec3 p = position;
      float ang = uTime*(0.04 + uSwirl*0.9)*(0.4+aSeed);
      p.xz = mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*p.xz;
      float w = uTime*(0.02 + uSwirl*0.3)*(aSeed-0.5);
      p.xy = mat2(cos(w),-sin(w),sin(w),cos(w))*p.xy;
      p += normalize(p)*(sin(uTime*1.3 + aSeed*40.0)*0.035 + uSpread*(0.25+0.75*aSeed));
      vec4 mv = modelViewMatrix*vec4(p,1.0);
      gl_PointSize = (1.1 + aSeed*2.4)*uPix*(9.0/-mv.z)*(0.4+0.6*uK);
      vA = 0.25 + 0.75*pow(abs(sin(uTime*0.7 + aSeed*25.0)), 3.0);
      vS = aSeed;
      gl_Position = projectionMatrix*mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uK,uDim; varying float vA; varying float vS;
    void main(){
      float d = length(gl_PointCoord-0.5); if(d>0.5) discard;
      float a = smoothstep(0.5,0.0,d)*vA*uDim*(0.3+0.7*uK);
      vec3 c = mix(uColor, vec3(1.0), step(0.94, vS)*0.5);
      gl_FragColor = vec4(c, a*0.5);
    }`
}));
orb.add(particles);

const ringMats = [];
const deg = THREE.MathUtils.degToRad;
function meshArc(rIn, rOut, arcs, opacity) {
  const geoms = arcs.map(([a0, a1]) => new THREE.RingGeometry(rIn, rOut, Math.max(4, Math.round((a1 - a0) / 1.5)), 1, deg(a0), deg(a1 - a0)));
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  m.userData.base = opacity; ringMats.push(m);
  return new THREE.Mesh(mergeGeometries(geoms), m);
}
const dashes = (n, f) => Array.from({ length: n }, (_, i) => [i * 360 / n, i * 360 / n + 360 / n * f]);
const rings = [
  { o: meshArc(1.515, 1.545, [[0, 110], [120, 230], [240, 350]], .9), mv: 'step', A: 120, per: 4.2, dir: 1, tilt: [0, 0, 0], tone: 'ring' },
  { o: meshArc(1.60, 1.606, [[0, 320]], .45), mv: 'spin', sp: .9, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(1.70, 1.765, dashes(120, .22), .5), mv: 'spin', sp: -.08, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(1.66, 1.83, dashes(12, .035), .8), mv: 'step', A: 30, per: 2.6, dir: -1, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(1.40, 1.407, [[20, 160], [200, 340]], .55), mv: 'wave', sp: -.5, amp: .9, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(1.88, 1.888, [[0, 70], [90, 200], [230, 300]], .5), mv: 'wave', sp: .22, amp: 1.2, tilt: [0, 0, 0], tone: 'ring' },
  { o: meshArc(2.02, 2.03, [[30, 150], [210, 330]], .55), mv: 'wave', sp: -.16, amp: 1.5, tilt: [0, 0, 0], tone: 'ring' },
  { o: meshArc(2.16, 2.166, [[0, 45], [65, 175], [180, 225], [245, 355]], .4), mv: 'wave', sp: .1, amp: .8, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(2.30, 2.314, dashes(90, .5), .3), mv: 'spin', sp: .04, tilt: [0, 0, 0], tone: 'ring' },
  { o: meshArc(1.95, 1.985, [[0, 150], [180, 330]], .7), mv: 'spin', sp: .55, prec: .18, tilt: [1.2, 0, 0], tone: 'dark' },
  { o: meshArc(2.10, 2.11, [[20, 160], [200, 340]], .5), mv: 'spin', sp: -.4, prec: -.13, tilt: [-1.2, 0, 0], tone: 'ring' },
  { o: meshArc(1.75, 1.757, [[0, 300]], .3), mv: 'spin', sp: .3, prec: .25, tilt: [1.45, 0, 0], tone: 'light' },
  { o: meshArc(1.115, 1.15, [[0, 360]], .75), mv: 'breath', ph: 0, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(1.165, 1.195, dashes(72, .3), .45), mv: 'spin', sp: .12, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(1.22, 1.27, [[35, 55], [125, 145], [215, 235], [305, 325]], .85), mv: 'step', A: 90, per: 2.4, dir: -1, tilt: [0, 0, 0], tone: 'ring' },
  { o: meshArc(2.56, 2.575, [[-28, 28], [152, 208]], .7), mv: 'swing', A: 14, f: .55, ph: 0, tilt: [0, 0, 0], tone: 'light' },
  { o: meshArc(2.62, 2.627, [[-40, -32], [32, 40], [140, 148], [212, 220]], .6), mv: 'swing', A: 22, f: .55, ph: Math.PI, tilt: [0, 0, 0], tone: 'light' }
];
const ringRoot = new THREE.Group();
orb.add(ringRoot);
rings.forEach((r) => { const h = new THREE.Group(); h.rotation.order = 'ZXY'; h.rotation.set(r.tilt[0], r.tilt[1], r.tilt[2]); h.add(r.o); ringRoot.add(h); r.h = h; });
const beadMat = new THREE.MeshBasicMaterial({ color: '#e8f6ff' });
[110, 230, 350].forEach((a) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 12), beadMat); const t = THREE.MathUtils.degToRad(a); m.position.set(Math.cos(t) * 1.53, Math.sin(t) * 1.53, 0); rings[0].o.add(m); });

/* shockwaves, scan band, comets */
const waveMats = [], waves = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const w = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.008, 128), m);
  w.userData.t = -1; waveMats.push(m); waves.push(w); orb.add(w);
}
let waveClock = 0, waveIdx = 0;
const bandMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, opacity: .0, blending: THREE.AdditiveBlending, depthWrite: false });
const band = new THREE.Mesh(new THREE.TorusGeometry(1, .006, 6, 160), bandMat);
band.rotation.x = Math.PI / 2; orb.add(band);
const TRAIL = 46;
const comets = [[2.05, 1.2, 0, 1.1], [2.35, -1.2, 0, -.8], [1.85, 0, 0, .7], [2.45, 0, 0, -.55]].map(([r, tx, tz, sp]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const holder = new THREE.Group(); holder.rotation.set(tx, 0, tz); holder.add(line); orb.add(holder);
  return { line, r, sp, a: Math.random() * 6.28 };
});

const starN = GL ? 1400 : 0, sp = new Float32Array(starN * 3);
for (let i = 0; i < starN; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(30 + Math.random() * 50); sp.set([v.x, v.y, v.z], i * 3); }
const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
const starMat = new THREE.PointsMaterial({ color: '#6f9fd6', size: .08, transparent: true, opacity: .5, depthWrite: false });
scene.add(new THREE.Points(starGeo, starMat));

let composer = renderer ? new EffectComposer(renderer) : null;
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .7, .35, .32);
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
if (quality === 'lite') bloom.enabled = false;

function viewSize() { const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z; return { w: h * camera.aspect, h }; }
// orb outer radius is ~2.6 units at scale 1; size it to ~54% of the short side
function baseScale() { const v = viewSize(); return clamp(0.54 * Math.min(v.w, v.h) / 5.2, .35, .9); }

let mode = 'idle';
let lastSmall = false;
function placeOrb(dur = 1.2) {
  const m = MODES[mode], v = viewSize(), base = baseScale(), narrow = window.innerWidth < 900;
  let s = m.s * base, x = 0, y = v.h * .05;
  const R = 2.6 * s;
  if (m.place === 'high') y = v.h * (narrow ? .14 : .12);
  if (m.place === 'park') { s = (narrow ? .34 : .42) * base; const r = 2.6 * s; x = v.w / 2 - r - v.w * .03; y = -v.h / 2 + r + v.h * (narrow ? .13 : .11); }
  if (m.place === 'left') { if (narrow) { s = .5 * base; x = 0; y = v.h / 2 - 2.6 * s - v.h * .16; } else { x = -v.w * .2; y = 0; } }
  if (R > v.h * .5) s *= (v.h * .5) / R;
  const small = m.place === 'park';
  if (dur > 0 && small !== lastSmall) {
    gsap.fromTo(S, { burst: .7 }, { burst: 0, duration: 1.6, ease: 'expo.out' });
    gsap.fromTo(S, { warp: 1 }, { warp: 0, duration: 1.4, ease: 'power2.out' });
  }
  lastSmall = small;
  gsap.to(S, { x, y, s, duration: dur, ease: 'expo.inOut', overwrite: 'auto' });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (renderer) { renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h); }
  camera.aspect = w / h; camera.fov = w < 700 ? 58 : 45; camera.updateProjectionMatrix();
  rain.resize();
  if (booted) placeOrb(0);
}

const mouse = { x: 0, y: 0 };
window.addEventListener('pointermove', (e) => { mouse.x = (e.clientX / innerWidth) * 2 - 1; mouse.y = (e.clientY / innerHeight) * 2 - 1; });

const label = $('#orbLabel'), wm = $('#wm'), sub = $('#orbSub');
const rainEl = $('#rain'); const rain = createRain(rainEl);
const cssOrb = quality === 'css' ? createCssOrb($('#app'), $('#callouts')) : null;
let cssOrbLive = cssOrb;
const calls = /** @type {[string, number, number, number, number][]} */ ([['#co1', -1.15, .95, -150, -46], ['#co2c', 1.35, .5, 150, -40], ['#co3', 1.0, -1.15, 140, 44]]).map(([id, ax, ay, dx, dy]) => {
  const g = $(id); const [t1, t2] = g.querySelectorAll('text');
  return { ax, ay, dx, dy, pl: g.querySelector('polyline'), dot: g.querySelector('circle'), t1, t2 };
});
const tmpV = new THREE.Vector3();
const waveBars = [];
const clock = new THREE.Clock();
let ringPhase = 0, glitch = 0;
const fpsMeter = new FpsMeter();
const qualityListeners = [];
document.addEventListener('visibilitychange', () => fpsMeter.reset()); // a hidden tab stops animation frames: do not measure that
function watchFps(now) {
  if (!Q.auto || document.hidden) return;
  const fps = fpsMeter.tick(now);
  if (fps === null) return;
  const nq = nextQuality(quality, fps);
  if (nq) applyQuality(nq);
}
function applyQuality(q) {
  if (q === quality) return;
  const order = ['full', 'lite', 'css'];
  if (order.indexOf(q) < order.indexOf(quality)) return; // only ever step down at runtime; stepping up reloads
  if (q === 'lite' && renderer) {
    renderer.setPixelRatio(1); pU.uPix.value = 1; bloom.enabled = false;
    particles.geometry.setDrawRange(0, 1500);
    renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
  }
  if (q === 'css') {
    if (renderer) {
      composer && composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer = null; composer = null;
    }
    if (!cssOrbLive) cssOrbLive = createCssOrb($('#app'), $('#callouts'));
    cssOrbLive.setSpeed(MODES[mode] ? MODES[mode].look.ring : 1);
  }
  quality = q;
  $('#app').dataset.quality = q;
  fpsMeter.reset();
  qualityListeners.forEach((f) => f(q));
}
function frame(nowMs) {
  watchFps(nowMs || performance.now());
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime, speed = reduced ? .25 : 1;
  ringPhase += dt * (S.ring + S.warp * 8) * speed;

  // palette easing
  const k = 1 - Math.pow(.02, dt);
  for (const key in P) P[key].lerp(T[key], k);
  if (renderer) renderer.setClearColor(P.bg, 1);
  starMat.color.copy(P.part).multiplyScalar(.7);
  const light = P.rim.clone().lerp(new THREE.Color(1, 1, 1), .1), dark = P.ring.clone().lerp(P.deep, .12);
  rings.forEach((r) => r.o.material.color.copy(r.tone === 'light' ? light : r.tone === 'dark' ? dark : P.ring));
  cageMat.color.copy(P.ring);

  // fake voice envelope while listening
  let audio = 0;
  if (mode === 'listen') audio = Math.max(0, Math.sin(t * 6.3) * Math.sin(t * 2.1) * .6 + Math.sin(t * 13.7) * .25 + .35);
  S.audio += (audio - S.audio) * .18;

  // glitch while in alert
  let jx = 0, jy = 0, gk = 1;
  if (mode === 'alert' && !reduced) {
    if (glitch <= 0 && Math.random() < .035) glitch = .08 + Math.random() * .12;
    if (glitch > 0) { glitch -= dt; jx = (Math.random() - .5) * .12 * S.s; jy = (Math.random() - .5) * .06 * S.s; gk = 1.5 + Math.random(); }
  } else glitch = 0;
  wm.classList.toggle('glitch', glitch > 0);

  const base = baseScale(), K = clamp(S.s / base, 0, 1);
  coreU.uTime.value = t * speed;
  coreU.uAmp.value = S.amp + S.audio * .32;
  coreU.uFreq.value = S.freq;
  coreU.uGlow.value = S.glow * (1 + S.audio * .5) * gk * (.5 + .5 * K);
  pU.uTime.value = t * speed; pU.uSwirl.value = S.swirl; pU.uSpread.value = S.spread + S.audio * .45 + S.burst;
  pU.uK.value = K; pU.uDim.value = S.dim;
  ringMats.forEach((m) => { m.opacity = Math.min(1, m.userData.base * 1.2) * clamp(S.dim * 1.3, .25, 1) * (mode === 'alert' && glitch > 0 ? .4 : 1); });
  bloom.strength = S.bloom * (.35 + .65 * K);

  const ease3 = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  rings.forEach((r, i) => {
    const o = r.o;
    if (r.mv === 'spin') o.rotation.z = ringPhase * r.sp;
    else if (r.mv === 'wave') o.rotation.z = ringPhase * r.sp + Math.sin(ringPhase * .45 + i) * r.amp;
    else if (r.mv === 'step') { const u = ringPhase / r.per, f = u - Math.floor(u); o.rotation.z = r.dir * deg(r.A) * (Math.floor(u) + ease3(Math.min(1, f / .38))); }
    else if (r.mv === 'swing') { o.rotation.z = deg(r.A) * Math.sin(t * r.f + r.ph); o.scale.setScalar(1 + .012 * Math.sin(t * 1.1 + r.ph)); }
    else if (r.mv === 'breath') { const b = Math.sin(t * 1.6); o.scale.setScalar(1 + .022 * b); o.material.opacity *= .8 + .2 * (b * .5 + .5); }
    if (r.prec) r.h.rotation.z += dt * r.prec * (.6 + .4 * S.ring) * speed;
  });
  ringRoot.rotation.set(0, 0, 0);
  cage.rotation.y = t * .08 * speed; cage.rotation.x = t * .05 * speed;
  orb.position.set(jx, jy, 0);
  orb.scale.setScalar(Math.max(S.s, .001));

  // shockwaves
  const every = mode === 'alert' ? .9 : mode === 'think' ? 1.4 : 1e9;
  waveClock += dt;
  if (waveClock > every) { waveClock = 0; waves[waveIdx].userData.t = 0; waveIdx = (waveIdx + 1) % waves.length; }
  waves.forEach((w, i) => {
    const u = w.userData;
    if (u.t < 0) { waveMats[i].opacity = 0; return; }
    u.t += dt / 2.4; if (u.t > 1) { u.t = -1; return; }
    const e = 1 - Math.pow(1 - u.t, 3);
    w.scale.setScalar(1.05 + e * 1.6);
    waveMats[i].opacity = (1 - u.t) * .35 * S.dim; waveMats[i].color.copy(P.rim);
  });
  // scan band sweeping the core
  const scanOn = ['research', 'locate', 'vision', 'idle', 'listen'].includes(mode) ? 1 : 0;
  const by = Math.sin(t * .9) * 1.05;
  band.position.y = by; band.scale.setScalar(Math.sqrt(Math.max(.02, 1.21 - by * by)));
  bandMat.color.copy(P.rim); bandMat.opacity += ((scanOn ? .7 : 0) * S.dim - bandMat.opacity) * .05;
  // comets with fading trails
  comets.forEach((c) => {
    c.a += dt * c.sp * (1 + S.ring * .25 + S.warp * 3) * speed;
    const pos = c.line.geometry.attributes.position.array, col = c.line.geometry.attributes.color.array;
    for (let k = 0; k < TRAIL; k++) {
      const a = c.a - k * .028 * Math.sign(c.sp), f = 1 - k / TRAIL;
      pos[k * 3] = Math.cos(a) * c.r; pos[k * 3 + 1] = Math.sin(a) * c.r; pos[k * 3 + 2] = 0;
      const b = f * f * S.dim * 1.2;
      col[k * 3] = P.rim.r * b + (k === 0 ? .6 : 0); col[k * 3 + 1] = P.rim.g * b + (k === 0 ? .6 : 0); col[k * 3 + 2] = P.rim.b * b + (k === 0 ? .6 : 0);
    }
    c.line.geometry.attributes.position.needsUpdate = true; c.line.geometry.attributes.color.needsUpdate = true;
  });

  camera.position.x += (mouse.x * .22 - camera.position.x) * .04;
  camera.position.y += (-mouse.y * .16 - camera.position.y) * .04;
  camera.lookAt(0, 0, 0);
  // lens shift: move the orb on screen without perspective skew
  { const v = viewSize(); camera.setViewOffset(innerWidth, innerHeight, -S.x / v.w * innerWidth, S.y / v.h * innerHeight, innerWidth, innerHeight); }
  if (renderer && mode !== 'vision') composer.render();

  // wordmark pinned to the orb's centre
  tmpV.set(jx, jy, 0).project(camera);
  const px = (tmpV.x * .5 + .5) * innerWidth, py = (-tmpV.y * .5 + .5) * innerHeight;
  const coreDiam = 2 * .92 * S.s / viewSize().h * innerHeight; // px
  const ls = clamp(coreDiam / 182, .32, 1.25);
  label.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) translate(-50%,-50%) scale(${ls.toFixed(3)})`;
  label.style.opacity = mode === 'vision' ? 0 : clamp(S.glow * 1.25, 0, 1) * clamp(S.s * 6, 0, 1);
  sub.style.opacity = K > .62 && coreDiam > 120 ? 1 : 0;

  // code rain, kept clear of the orb
  const orbPx = 2.6 * S.s / viewSize().h * innerHeight;
  rainEl.style.setProperty('--ox', px.toFixed(0) + 'px'); rainEl.style.setProperty('--oy', py.toFixed(0) + 'px'); rainEl.style.setProperty('--or', (orbPx * .9).toFixed(0) + 'px');
  if (quality === 'full') rain.draw(dt, '#' + P.part.getHexString(), mode === 'think' ? .9 : mode === 'alert' ? .8 : .45);
  if (cssOrbLive && !renderer) cssOrbLive.update(px, py, mode === 'vision' ? 0 : orbPx, S.glow, S.dim);

  // HUD callouts pinned to points on the orb
  if (K > .6 && innerWidth >= 1200) {
    calls.forEach((c) => {
      tmpV.set(c.ax * S.s + jx, c.ay * S.s + jy, 0).project(camera);
      const ax = (tmpV.x * .5 + .5) * innerWidth, ay = (-tmpV.y * .5 + .5) * innerHeight;
      const ex = ax + c.dx * .5, ey = ay + c.dy, lx = ax + c.dx;
      c.pl.setAttribute('points', `${ax.toFixed(1)},${ay.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)} ${lx.toFixed(1)},${ey.toFixed(1)}`);
      c.dot.setAttribute('cx', ax.toFixed(1)); c.dot.setAttribute('cy', ay.toFixed(1));
      const tx = lx + (c.dx < 0 ? -6 : 6);
      c.t1.setAttribute('x', tx.toFixed(1)); c.t1.setAttribute('y', (ey - 6).toFixed(1));
      c.t2.setAttribute('x', tx.toFixed(1)); c.t2.setAttribute('y', (ey + 12).toFixed(1));
    });
  }

  if (mode === 'listen') waveBars.forEach((b, i) => { const n = .5 + .5 * Math.sin(t * (7 + i * .37) + i * 1.7); b.style.transform = `scaleY(${(.12 + S.audio * (.3 + .7 * n)).toFixed(3)})`; });
  requestAnimationFrame(frame);
}

/* ---------------- HUD helpers ---------------- */
const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ABCDEF';
function scramble(el, text, dur = .7) {
  const n = { p: 0 };
  return gsap.to(n, { p: 1, duration: dur, ease: 'none', overwrite: true,
    onUpdate() { const k = Math.floor(text.length * n.p); let out = text.slice(0, k); for (let i = k; i < text.length; i++) out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0]; el.textContent = out; },
    onComplete() { el.textContent = text; } });
}
function countUp(el, to, dec = 0, sep = false, dur = 1.4) {
  // Live values (data-live) may change while the intro counts: always aim at the element's current data-count.
  const target = () => (el.dataset.live !== undefined && el.dataset.count !== undefined && Number.isFinite(parseFloat(el.dataset.count)) ? parseFloat(el.dataset.count) : to);
  const n = { p: 0 };
  return gsap.to(n, { p: 1, duration: dur, ease: 'power3.out', onUpdate: () => { let s = (target() * n.p).toFixed(dec); if (sep) s = Number(s).toLocaleString('en-US'); el.textContent = s; } });
}
function typeText(el, text, cps = 55) {
  const n = { i: 0 }; el.textContent = '';
  return gsap.to(n, { i: text.length, duration: text.length / cps, ease: 'none', onUpdate: () => { el.textContent = text.slice(0, Math.round(n.i)); } });
}
function revealPanels(panels, start = .1, gap = .12) {
  gsap.set(panels, { clipPath: 'inset(50% 0% 50% 0%)', opacity: 0 });
  panels.forEach((p, i) => {
    const at = start + i * gap;
    gsap.to(p, { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, duration: .75, ease: 'expo.out', delay: at });
    gsap.delayedCall(at + .1, () => {
      p.classList.remove('live'); void p.offsetWidth; p.classList.add('live');
      const h = p.querySelector('[data-scr]'); if (h) scramble(h, h.dataset.final || (h.dataset.final = h.textContent), .6);
      panelFx(p);
    });
  });
}

setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false }); }, 1000);

const co2 = [980, 1080, 1190, 1290, 1380, 1420, 1360, 1100, 820, 700, 640, 620, 650, 720, 780, 760, 740, 800, 860, 900, 940, 960, 940, 960];
const barHtml = (arr) => arr.map((v) => `<i class="${v > 1000 ? 'w' : ''}" style="height:${(v / 1500 * 100).toFixed(1)}%"></i>`).join('');
$('#spark').innerHTML = barHtml(co2.slice(0, 23).concat([1180]));
$('#bars').innerHTML = barHtml(co2);
$('#wave').innerHTML = Array.from({ length: 36 }, () => '<i></i>').join('');
waveBars.push(...$$('#wave i'));

const DEFAULT_LOG = [
  ['agent', 'Parsed request → compare CO₂ sensor types'], ['search', 'query: "NDIR CO2 sensor ESP8266" · 6 hits'],
  ['read', 'NDIR datasheet · extracted interface specs'], ['read', 'ESPHome docs · I2C and UART supported'],
  ['search', 'query: "MOX eCO2 accuracy bedroom" · 4 hits'], ['read', 'forum thread · eCO₂ drifts in sealed rooms'],
  ['data', 'pulled 24h CO₂ from environment node'], ['agent', 'cross-checking sources [1] [4] [7]']
];
let LOG = DEFAULT_LOG;
let logTimer = null;
function streamLog() {
  const box = $('#log'); box.innerHTML = ''; let i = 0;
  clearInterval(logTimer);
  logTimer = setInterval(() => {
    const [tg, msg] = LOG[i++ % LOG.length];
    const row = document.createElement('div');
    row.innerHTML = `<span class="ts">${new Date().toLocaleTimeString('en-GB', { hour12: false })}</span><span class="tg">[${tg}]</span><span></span>`;
    box.appendChild(row); typeText(row.lastChild, msg, 90); gsap.from(row, { opacity: 0, x: -10, duration: .3 });
    while (box.children.length > 6) box.firstChild.remove();
  }, 900);
}
function panelFx(p) {
  const k = p.dataset.p;
  if (k === 'stat') { countUp($('#srcCount'), +$('#srcCount').dataset.to || 0, 0, false, 1.6); gsap.fromTo('#srcMeter', { width: '0%' }, { width: (+$('#srcMeter').dataset.to || 0) + '%', duration: 1.6, ease: 'power3.out' }); }
  if (k === 'co2') gsap.from('#bars i', { scaleY: 0, stagger: .025, duration: .7, ease: 'expo.out' });
  if (k === 'steps') { const li = $$('#steps li'); li.forEach((l) => { l.className = ''; }); li.forEach((l, i) => gsap.delayedCall(.25 + i * .28, () => { l.className = l.dataset.s === 'wait' ? '' : l.dataset.s; gsap.from(l, { opacity: 0, x: -8, duration: .3 }); })); }
  if (k === 'source') gsap.fromTo('.schem g:first-child *', { strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 1.8, stagger: .12, ease: 'power2.inOut' });
  if (k === 'compare') gsap.from('.cmp tbody tr', { opacity: 0, x: -12, stagger: .18, duration: .4, delay: .2 });
  if (k === 'note') typeText($('#note'), $('#note').dataset.text, 60);
  if (k === 'map') {
    const r = $('#route'); const len = r.getTotalLength(); r.style.strokeDasharray = len; 
    gsap.fromTo(r, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut', delay: .3 });
    gsap.from('#map .you', { scale: 0, transformOrigin: '140px 400px', duration: .6, ease: 'back.out(3)' });
    gsap.from('#map .pin, #map .tag', { opacity: 0, y: -12, duration: .6, stagger: .15, delay: 2.2, ease: 'expo.out' });
    gsap.from('#map svg > g:nth-of-type(1) rect', { opacity: 0, duration: .4, stagger: { each: .004, from: 'random' } });
  }
  if (k === 'target') countUp($('#dist'), Number.isFinite(+$('#dist').dataset.to) ? +$('#dist').dataset.to : 2.4, 1, false, 2.2);
  if (k === 'route') gsap.from('.turns li', { opacity: 0, x: -10, stagger: .25, duration: .4, delay: .3 });
  if (k === 'nmea') { const box = $('#nmea'); box.innerHTML = ''; timers.push(setInterval(() => { const d = document.createElement('div'); box.appendChild(d); typeText(d, nmeaLine(), 160); while (box.children.length > 7) box.firstChild.remove(); }, 450)); }
}

/* chart expand via Flip */
const co2Panel = $('#co2'); const slot = document.createComment('co2-slot'); let expanded = false;
function expandChart() {
  if (expanded) return; expanded = true;
  const st = Flip.getState(co2Panel);
  co2Panel.parentNode.insertBefore(slot, co2Panel); $('#xLayer').appendChild(co2Panel);
  Flip.from(st, { duration: .9, ease: 'expo.inOut', absolute: true, scale: false });
  gsap.to('#grid .panel:not(#co2), .rhead', { opacity: .12, filter: 'blur(2px)', duration: .6 });
  gsap.from('#co2 .x-only', { opacity: 0, y: 8, duration: .5, delay: .6, stagger: .08 });
  gsap.from('#bars i', { scaleY: 0, stagger: .02, duration: .7, ease: 'expo.out', delay: .5 });
}
function collapseChart(instant) {
  if (!expanded) return; expanded = false;
  const st = Flip.getState(co2Panel);
  slot.parentNode.insertBefore(co2Panel, slot); slot.remove();
  if (!instant) Flip.from(st, { duration: .8, ease: 'expo.inOut', absolute: true, scale: false });
  gsap.to('#grid .panel, .rhead', { opacity: 1, filter: 'blur(0px)', duration: .5 });
}
$('#expand').addEventListener('click', expandChart);
$('#collapse').addEventListener('click', () => collapseChart());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapseChart(); });

/* ---------------- live metrics: values come from the data layer (see ui/live.ts) ---------------- */
function zap(el, text) {
  if (!el) return;
  el.classList.remove('zap'); void el.getBoundingClientRect(); el.classList.add('zap');
  const n = { p: 0 };
  gsap.to(n, { p: 1, duration: .42, ease: 'none',
    onUpdate() { el.textContent = text.replace(/[0-9]/g, (d) => (Math.random() < 1 - n.p ? String((Math.random() * 10) | 0) : d)); },
    onComplete() { el.textContent = text; } });
  setTimeout(() => el.classList.remove('zap'), 520);
}

/* ---------------- scenario intros ---------------- */
let timers = [];
let focusPaused = false;
const clearTimers = () => { timers.forEach((id) => clearInterval(id)); timers = []; clearInterval(logTimer); vision.stop(); };
$('#map').innerHTML = mapSVG();
const vision = createVision($('#feed'), $('#vlayer'), {
  onDetect() { const n = +$('#vcount').textContent + 1; $('#vcount').textContent = n; sfx.tick(900 + n * 60); },
  onPhase(p) {
    if (p === vPhase) return; vPhase = p;
    $('#vphase').textContent = p === 'inspect' ? 'INSPECTING · RASPBERRY PI 3' : 'SCANNING';
    $('#vspec').classList.toggle('on', p === 'inspect');
    $$('.vctl button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === p)));
    if (p === 'inspect') { sfx.lock(); gsap.fromTo('#vspec .srow', { opacity: 0, x: 12 }, { opacity: 1, x: 0, stagger: .07, duration: .4, delay: .5 }); }
  }
});
let vPhase = '';
$$('.vctl button').forEach((b) => b.addEventListener('click', () => { sfx.click(); if (b.dataset.v === 'rescan') { $('#vcount').textContent = 0; vision.rescan(); } else vision.view(b.dataset.v); }));
const INTRO = {
  idle() {
    $$('[data-count]').forEach((el) => countUp(el, parseFloat(el.dataset.count), +(el.dataset.dec || 0), !!el.dataset.sep, 1.6));
    // fromTo, not from: the intro can restart before it ends (a retained scene right after load), and `from` would take
    // the half-faded values as its end state and leave the readings invisible
    gsap.fromTo('.ro', { x: (i, el) => (el.classList.contains('r') ? 30 : -30), opacity: 0 }, { x: 0, opacity: 1, duration: .9, stagger: .1, ease: 'expo.out', delay: .3, overwrite: true });
    gsap.fromTo('#spark i', { scaleY: 0 }, { scaleY: 1, transformOrigin: 'bottom', stagger: .02, duration: .5, ease: 'expo.out', delay: .6, overwrite: true });
    { const cap = $('.caption'); scramble(cap, cap.dataset.text || cap.textContent, 1); }
  },
  listen() {
    gsap.fromTo('#wave', { opacity: 0, scaleX: .3 }, { opacity: 1, scaleX: 1, duration: .6, ease: 'expo.out', overwrite: true });
    const el = $('#transcript'); el.textContent = '';
    gsap.delayedCall(.5, () => typeText(el, el.dataset.text || '', 22));
  },
  think() {
    const chips = $$('#chips .chip'); chips.forEach((c) => { c.className = 'chip'; });
    gsap.from(chips, { opacity: 0, y: 12, stagger: .12, duration: .5, ease: 'expo.out' });
    chips.forEach((c, i) => gsap.delayedCall(.35 + i * .45, () => { c.className = 'chip ' + c.dataset.s; }));
    $('#plan').textContent = '';
    gsap.delayedCall(1.6, () => scramble($('#plan'), $('#plan').dataset.text || '', .8));
  },
  research() {
    gsap.fromTo('.rhead', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', delay: .15 });
    scramble($('#rtitle'), $('#rtitle').textContent, .8);
    revealPanels($$('#grid .panel'), .35, .13);
    streamLog();
  },
  locate() {
    gsap.fromTo('[data-tpl=locate] .rhead', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .5, ease: 'expo.out', delay: .15 });
    revealPanels($$('[data-tpl=locate] .panel'), .3, .14);
  },
  vision() {
    $('#vcount').textContent = 0; vPhase = ''; $('#vspec').classList.remove('on');
    vision.start();
    gsap.fromTo('.vhud, .vctl', { opacity: 0, y: -8 }, { opacity: 1, y: 0, stagger: .1, duration: .6, delay: .4 });
  },
  briefing() {
    gsap.fromTo('.greet > *', { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: .12, duration: .8, ease: 'expo.out', delay: .3 });
    revealPanels($$('.brief .panel'), .7, .15);
  },
  focus() {
    const total = (+$('#timer').dataset.total || 25 * 60), el = $('#timer'), bar = $('#tbar'); let spent = 0, lastT = Date.now(); focusPaused = false; $('#fPause').textContent = 'Pause';
    const tick = () => { const now = Date.now(); if (!focusPaused) spent += (now - lastT) / 1000; lastT = now; const left = Math.max(0, total - spent); const m = Math.floor(left / 60), s = Math.floor(left % 60); el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; bar.style.width = `${((total - left) / total * 100).toFixed(2)}%`; };
    tick(); timers.push(setInterval(tick, 250));
    gsap.fromTo('[data-tpl=focus] > *', { opacity: 0, y: 12 }, { opacity: 1, y: 0, stagger: .1, duration: .7, ease: 'expo.out', delay: .4 });
  },
  alert() {
    revealPanels($$('.alert-card'), .3, 0);
    gsap.fromTo('.alert-card', { x: 0 }, { keyframes: { x: [0, -10, 9, -6, 4, 0] }, duration: .5, delay: .9 });
  },
  success() {
    revealPanels($$('[data-tpl=success] .panel'), .5, 0);
    gsap.from('.checks li', { opacity: 0, x: -10, stagger: .2, duration: .4, delay: 1 });
    gsap.fromTo(S, { burst: 1.1 }, { burst: 0, duration: 2.2, ease: 'expo.out' });
  },
  sleep() {
    const el = $('#lightsOff'); let n = Number.isFinite(+el.dataset.from) ? +el.dataset.from : 30; el.textContent = n;
    timers.push(setInterval(() => { n = Math.max(0, n - 1); el.textContent = n; }, 1000));
    gsap.fromTo('[data-tpl=sleep] > *', { opacity: 0, y: 12 }, { opacity: 1, y: 0, stagger: .2, duration: 1.4, ease: 'power2.out', delay: .4 });
  }
};

/* ---------------- mode switching ---------------- */
const app = $('#app');

function applyColour() {
  const col = FIXED[mode] ? MODES[mode] : LEVELS[level];
  app.style.setProperty('--accent', col.c);
  setPalette(col.pal);
}
function setLevel(l) { if (!LEVELS[l] || FIXED[mode]) return; level = l; applyColour(); }

let statusOverride = null;
function setMode(m, force) {
  if (!MODES[m] || (m === mode && !force)) return;
  mode = m;
  const cfg = MODES[m];
  app.dataset.mode = m;
  level = DEFAULT_LVL[m] || 'normal';
  applyColour();
  sfx.mode(m);
  scramble($('#status'), statusOverride || cfg.status, .5);
  if (cssOrbLive) cssOrbLive.setSpeed(cfg.look.ring);
  scramble(sub, cfg.sub.toUpperCase(), .6);
  gsap.to(S, { ...cfg.look, duration: 1.1, ease: 'power3.out', overwrite: 'auto' });
  placeOrb();
  clearTimers();
  collapseChart(true);
  $$('.tpl').forEach((el) => {
    const on = el.dataset.tpl === m;
    el.classList.toggle('on', on);
    gsap.to(el, { autoAlpha: on ? 1 : 0, duration: on ? .5 : .3, delay: on ? .15 : 0, overwrite: true });
  });
  INTRO[m] && INTRO[m]();
}

$('#micBtn').addEventListener('click', () => hooks.onMic && hooks.onMic());
$('#fPause').addEventListener('click', () => { focusPaused = !focusPaused; $('#fPause').textContent = focusPaused ? 'Resume' : 'Pause'; sfx.click(); });
$('#fEnd').addEventListener('click', () => setMode('idle'));
// confirmation card (scene alert with `confirm`): the buttons answer the brain like typing yes / no would
$('#aConfirm').addEventListener('click', () => hooks.onCommand && hooks.onCommand('yes'));
$('#aCancel').addEventListener('click', () => hooks.onCommand && hooks.onCommand('no'));
$('#aExplain').addEventListener('click', () => hooks.onCommand && hooks.onCommand('sao fail'));
$('#aOpen').addEventListener('click', () => {
  const url = $('#aOpen').dataset.url;
  if (url && url.startsWith('https://')) window.open(url, '_blank', 'noopener,noreferrer');
});
$('#aSnooze').addEventListener('click', () => setMode('idle'));
document.addEventListener('pointerover', (e) => { const t = /** @type {Element} */ (e.target); if (t.closest && t.closest('button')) sfx.hover(); });
$('#cmd').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim(); $('#q').value = '';
  if (!q) { hooks.onMic && hooks.onMic(); return; }
  // the display only publishes the command; the brain decides what the screen shows (vega/ui/scene)
  hooks.onCommand && hooks.onCommand(q);
});

/* ---------------- boot (called by boot.ts once the data layer has painted its first values) ---------------- */
let booted = false;
let started = false;
export function start() {
  if (started) return;
  started = true;
  resize();
  window.addEventListener('resize', resize);
  gsap.set('.tpl', { autoAlpha: 0 });
  S.s = .001; S.glow = 0;
  booted = true;
  const startMode = location.hash.slice(1);
  mode = '';
  setMode(MODES[startMode] ? startMode : 'idle');
  gsap.fromTo(S, { glow: 0 }, { glow: MODES[mode].look.glow, duration: 2.4, ease: 'expo.out', delay: .2 });
  gsap.from('.top', { opacity: 0, y: -14, duration: 1, ease: 'expo.out', delay: .4, clearProps: 'transform' }); // no leftover transform: the .sys cluster inside is position:fixed
  gsap.from('.frame i', { opacity: 0, scale: .4, duration: .8, stagger: .08, ease: 'expo.out' });
  gsap.from('.cmd', { opacity: 0, y: 20, duration: 1, ease: 'expo.out', delay: .9 });
  scramble(wm, 'VEGA', 1.4);
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (MODES[h]) setMode(h); });
  if (reduced) gsap.globalTimeline.timeScale(4);
  frame();
}

/* ---------------- API for the data layer, scene renderer and header controls (boot.ts) ---------------- */
export const hooks = { onCommand: null, onMic: null };
export const api = {
  $,
  $$,
  setMode,
  getMode: () => mode,
  setLevel,
  getLevel: () => level,
  setStatusOverride: (t) => { statusOverride = t || null; },
  setLog: (entries) => { LOG = entries && entries.length ? entries : DEFAULT_LOG; },
  zap,
  countUp,
  scramble,
  typeText,
  revealPanels,
  barHtml,
  getQuality: () => quality,
  isAutoQuality: () => Q.auto,
  onQuality: (f) => { qualityListeners.push(f); },
  hasWebGLContext: () => !!renderer
};
