import { noiseMath, snoise2D } from 'https://cdn.jsdelivr.net/npm/shox@1.2.0/src/Shox.js';

const DIARY_LABEL = 'My dear diary,';

// ═══════════════════════════════════════════════════════════════════════════
//  SHADER CONTROL — tweak everything here. All values feed the shader as
//  uniforms each frame, so you can change them and refresh to re-tune live.
// ═══════════════════════════════════════════════════════════════════════════
const PARAMS = {
  // ── Drip geometry ───────────────────────────────────────────────
  dripLength:   0.30,  // max downward reach at full heat (fraction of screen height)
  columnScale:  5.5,   // density of drip columns (higher = more, thinner streams)
  columnBias:   0.1,  // minimum drip even in calm columns (0 = none, 1 = always)
  falloffPow:   1.4,   // fade rate toward tip — higher = sharper fade
  streamSharp:  2.2,   // sharpness of individual streams (higher = thinner tendrils)

  // ── Horizontal wander ───────────────────────────────────────────
  wobbleAmp:    0.106, // sideways drift of a drip as it falls
  wobbleFreq:   1.5,   // horizontal frequency of that drift
  wobbleSpeed:  0.1,  // how fast the drift animates

  // ── Animation ───────────────────────────────────────────────────
  flowSpeed:    0.3,  // how fast drip column positions slowly drift
  dripsSpeed:   0.20,  // how fast drip content flows downward (liquid flow)

  // ── Chromatic aberration & glow ──────────────────────────────────
  aberration:   0.1,  // R/B channel offset at drip edges (0 = white, 1 = full split)
  energy:       0.18,  // persistent chromatic spread intensity
  energyScale:  0.5,   // how far R/B layers spread apart
  glow:         0.10,  // soft additive brightness bleed along drips (0 = off)

  // ── Heat / melt response ──────────────────────────────────────────────────────
  effectScale:  1.0,   // overall melt strength multiplier
  aqiOverride: 0,   // set to non-zero to override API AQI value
  aqiInfluence: 0.35,  // baseline melt driven by Belgrade AQI (0–1 of max)
  aqiMax:       300.0, // AQI value treated as "maximum pollution"

  // ── Text ────────────────────────────────────────────────────────
  fontSize:     64,    // main text size in px
  textColor:    '#ffffff',
};

// ─── Vertex shader ───────────────────────────────────────────────────────────
const MELT_VERT = `
  attribute vec3 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;

  void main() {
    vTexCoord = aTexCoord;
    vec4 pos = vec4(aPosition, 1.0);
    pos.xy = pos.xy * 2.0 - 1.0;
    gl_Position = pos;
  }
`;

// ─── Fragment shader — UV-displacement melt with drips ───────────────────────
// UV displacement approach (no gather loop): per-column noise drives a downward
// UV offset, so each pixel samples the source texture from above itself —
// letters appear to stretch and drip downward. Chromatic aberration splits
// R/G/B channels at slightly different offsets to produce colour fringing at
// drip edges. Total: 3 texture samples + a few fbm calls — very fast.
const MELT_FRAG = `
  precision highp float;

  varying vec2 vTexCoord;
  uniform sampler2D tex0;
  uniform float     time;
  uniform float     heat;
  uniform vec2      resolution;

  uniform float dripLength;
  uniform float columnScale;
  uniform float columnBias;
  uniform float falloffPow;
  uniform float streamSharp;
  uniform float wobbleAmp;
  uniform float wobbleFreq;
  uniform float wobbleSpeed;
  uniform float flowSpeed;
  uniform float dripsSpeed;
  uniform float aberration;
  uniform float energy;
  uniform float energyScale;
  uniform float glow;

  ${noiseMath}
  ${snoise2D}

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * snoise(p);
      p  = p * 2.1 + vec2(13.7, 9.2);
      a *= 0.5;
    }
    return v * 0.5 + 0.5;
  }

  void main() {
    vec2 uv   = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
    vec4 orig = texture2D(tex0, uv);

    float aspect = resolution.x / resolution.y;

    // Wide column shape — slow lateral drift sets where drips live
    float colWide   = fbm(vec2(uv.x * columnScale        + time * flowSpeed,        31.0));
    // Narrow stream shaping — higher frequency crushes wide blobs into thin tendrils
    float colNarrow = fbm(vec2(uv.x * columnScale * 2.8  + time * flowSpeed * 0.55 + 7.3, 17.5));
    float colStr    = mix(columnBias, 1.0, colWide) * pow(colNarrow, streamSharp);

    // Flow noise — scrolls downward over time, making drip content look liquid
    float flowN = fbm(vec2(uv.x * columnScale + time * flowSpeed * 0.25,
                           uv.y * 2.2         - time * dripsSpeed));
    float disp  = heat * dripLength * colStr * (0.4 + 0.6 * flowN);

    // Horizontal wobble
    float wn     = fbm(vec2(uv.x * wobbleFreq * aspect + time * wobbleSpeed, uv.y * 2.5));
    float wobble = (wn - 0.5) * 2.0 * wobbleAmp * heat;

    // Displacement vector: left/right wobble + upward sample offset.
    // Negative y means we read from above the current pixel → text stretches down.
    vec2 dispVec = vec2(wobble, -disp);

    // Chromatic aberration: R leads (less displaced), B trails (more displaced).
    // energy adds an independent vertical push — typing spreads the layers apart
    // without extending the drip downward.
    float sep = energy * energyScale * 0.04;
    vec2 uvG = uv + dispVec;
    vec2 uvR = uv + dispVec * (1.0 - aberration) + vec2(0.0,  sep);
    vec2 uvB = uv + dispVec * (1.0 + aberration) - vec2(0.0,  sep);

    float r = texture2D(tex0, uvR).r;
    float g = texture2D(tex0, uvG).g;
    float b = texture2D(tex0, uvB).b;

    // Smooth falloff: full brightness near source text, fades to 0 at drip tip
    float normDisp = clamp(disp / (heat * dripLength + 0.001), 0.0, 1.0);
    float falloff  = 1.0 - pow(normDisp, falloffPow);

    vec3 drip = vec3(r, g, b) * falloff;

    // Glow bleed along drip edges
    vec3 col = min(drip + drip * glow, vec3(1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── State ────────────────────────────────────────────────────────────────────
let cnv;
let pg;
let labelEl;
let textareaEl;
let meltShader;
let cursor = true;
let aqiRaw = 80;
let city   = '';   // empty until geolocation resolves
let geoLat, geoLng;
let t      = 0;

// ─── AQI fetch ────────────────────────────────────────────────────────────────
async function fetchAQIByCoords(lat, lng) {
  try {
    const res  = await fetch(`/api/aqi?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    if (data.status === 'ok') {
      aqiRaw = data.data.aqi;
      city   = data.data.city?.name || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
    }
  } catch (_) {}
}

function requestLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      geoLat = pos.coords.latitude;
      geoLng = pos.coords.longitude;
      fetchAQIByCoords(geoLat, geoLng);
      setInterval(() => fetchAQIByCoords(geoLat, geoLng), 5 * 60 * 1000);
    },
    _err => { /* location denied — city stays empty, submission stays blocked */ },
    { timeout: 10000, maximumAge: 60000 }
  );
}

// ─── Textarea positioning ─────────────────────────────────────────────────────
// Must match drawTextBuffer() exactly: same left margin, same top offset,
// same font size and line-height, same max-width — so selection highlights
// land precisely on the shader-rendered letters.
function positionTextarea() {
  if (!textareaEl) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const FONT = '"SF Mono", Menlo, "Courier New", monospace';
  Object.assign(textareaEl.style, {
    position:              'fixed',
    top:                   `${H * 0.27 - 8}px`,
    left:                  `${W * 0.055}px`,
    width:                 `${W * 0.88}px`,
    height:                `${H * 0.73}px`,
    fontSize:              `${PARAMS.fontSize}px`,
    lineHeight:            '1.4',
    fontFamily:            FONT,
    color:                 'transparent',
    caretColor:            'white',
    WebkitTextFillColor:   'transparent',
    background:            'transparent',
    border:                'none',
    outline:               'none',
    WebkitAppearance:      'none',
    resize:                'none',
    overflow:              'hidden',
    padding:               '0',
    margin:                '0',
    zIndex:                '5',
    whiteSpace:            'pre-wrap',
    wordWrap:              'break-word',
    textBaseline:          'top',
  });
}

// ─── p5 setup ─────────────────────────────────────────────────────────────────
function setup() {
  cnv = createCanvas(windowWidth, windowHeight, WEBGL);

  pg = createGraphics(width, height);
  pg.pixelDensity(pixelDensity());

  // Diary label — sits above canvas, unaffected by shader
  labelEl = createElement('p', DIARY_LABEL);
  labelEl.style('position',        'fixed');
  labelEl.style('top',             '5.5vh');
  labelEl.style('left',            '5.5vw');
  labelEl.style('margin',          '0');
  labelEl.style('font-family',     '"SF Mono", Menlo, "Courier New", monospace');
  labelEl.style('font-size',       '28px');
  labelEl.style('font-weight',     'bold');
  labelEl.style('color',           PARAMS.textColor);
  labelEl.style('pointer-events',  'none');
  labelEl.style('user-select',     'none');
  labelEl.style('z-index',         '10');

  // Textarea overlaid exactly on the shader text so selection highlights land
  // on the rendered letters. Position + font must match drawTextBuffer() exactly.
  const selStyle = document.createElement('style');
  selStyle.textContent = [
    '#shader-input::selection { background: rgba(255,255,255,0.25); }',
    '#shader-input::-moz-selection { background: rgba(255,255,255,0.25); }',
  ].join('');
  document.head.appendChild(selStyle);

  const ta = document.createElement('textarea');
  ta.id = 'shader-input';
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocorrect',  'off');
  ta.setAttribute('spellcheck',   'false');
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  });
  document.body.appendChild(ta);
  ta.focus();
  textareaEl = ta;
  positionTextarea();

  meltShader = createShader(MELT_VERT, MELT_FRAG);

  requestLocation();
}

// ─── Text rendering into 2D buffer ───────────────────────────────────────────
// Uses drawingContext (raw Canvas 2D) so any system font and size works
// regardless of the main canvas being in WEBGL mode.
function drawTextBuffer() {
  pg.clear();
  pg.background(0);

  const ctx    = pg.drawingContext;
  const margin = width * 0.055;
  const blockW = width * 0.88;
  const FONT   = '"SF Mono", Menlo, "Courier New", monospace';

  const mainSize = PARAMS.fontSize;
  const lineH    = mainSize * 1.4;

  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';

  // Main typed block with manual word-wrap
  ctx.font      = `${mainSize}px ${FONT}`;
  ctx.fillStyle = PARAMS.textColor;
  const text = textareaEl ? textareaEl.value : '';
  if (text === '') {
    ctx.fillStyle = '#888';
    ctx.fillText('type to write...', margin, height * 0.27);
    ctx.fillStyle = PARAMS.textColor;
  }
  wrapText(ctx, text, margin, height * 0.27, blockW, lineH);

  // Subtle AQI readout — bottom-right
  ctx.font         = `12px ${FONT}`;
  ctx.fillStyle    = '#3c3c3c';
  ctx.textBaseline = 'bottom';
  ctx.textAlign    = 'right';
  ctx.fillText(city ? `${city}  AQI ${aqiRaw}` : 'allow location to write', width - margin, height * 0.97);
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const paras = text.split('\n');
  let cy = y;
  for (const para of paras) {
    if (para === '') { cy += lineH; continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line !== '') {
        ctx.fillText(line, x, cy);
        line = word;
        cy  += lineH;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
}

// ─── p5 draw ──────────────────────────────────────────────────────────────────
function draw() {
  t += deltaTime / 1000;

  if (frameCount % 30 === 0) cursor = !cursor;

  const currentAqi = PARAMS.aqiOverride !== 0 ? PARAMS.aqiOverride : aqiRaw;
  const aqiHeat = constrain(currentAqi / PARAMS.aqiMax, 0, 1) * PARAMS.aqiInfluence * PARAMS.effectScale;
  const heat    = constrain(aqiHeat, 0, 1.0);

  drawTextBuffer();

  // Shader pass — melt applied only to pg (main text + AQI readout)
  shader(meltShader);
  meltShader.setUniform('tex0',         pg);
  meltShader.setUniform('time',         t);
  meltShader.setUniform('heat',         heat);
  meltShader.setUniform('resolution',   [width, height]);
  meltShader.setUniform('dripLength',   PARAMS.dripLength);
  meltShader.setUniform('columnScale',  PARAMS.columnScale);
  meltShader.setUniform('columnBias',   PARAMS.columnBias);
  meltShader.setUniform('falloffPow',   PARAMS.falloffPow);
  meltShader.setUniform('streamSharp',  PARAMS.streamSharp);
  meltShader.setUniform('wobbleAmp',    PARAMS.wobbleAmp);
  meltShader.setUniform('wobbleFreq',   PARAMS.wobbleFreq);
  meltShader.setUniform('wobbleSpeed',  PARAMS.wobbleSpeed);
  meltShader.setUniform('flowSpeed',    PARAMS.flowSpeed);
  meltShader.setUniform('dripsSpeed',   PARAMS.dripsSpeed);
  meltShader.setUniform('aberration',   PARAMS.aberration);
  meltShader.setUniform('energy',       PARAMS.energy);
  meltShader.setUniform('energyScale',  PARAMS.energyScale);
  meltShader.setUniform('glow',         PARAMS.glow);
  noStroke();
  rect(-width / 2, -height / 2, width, height);
}

// ─── Submit ───────────────────────────────────────────────────────────────────
async function submitMessage() {
  const text = textareaEl ? textareaEl.value.trim() : '';
  if (!text) return;
  if (!city) {
    labelEl.html('allow location first');
    setTimeout(() => labelEl.html(DIARY_LABEL), 2000);
    return;
  }
  textareaEl.value = '';
  const currentAqi = PARAMS.aqiOverride !== 0 ? PARAMS.aqiOverride : aqiRaw;
  try {
    await fetch('/api/message', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, city, aqi: currentAqi }),
    });
    labelEl.html('sent.');
    setTimeout(() => labelEl.html(DIARY_LABEL), 1500);
  } catch (_) {}
}

// ─── Responsive ───────────────────────────────────────────────────────────────
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pg.remove();
  pg = createGraphics(width, height);
  pg.pixelDensity(pixelDensity());
  positionTextarea();
}

// ─── Expose p5 globals — required because this file is an ES module ───────────
Object.assign(window, { setup, draw, windowResized });
