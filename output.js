import { noiseMath, snoise2D } from 'https://cdn.jsdelivr.net/npm/shox@1.2.0/src/Shox.js';

const FONT       = '"SF Mono", Menlo, "Courier New", monospace';
const MSG_SIZE   = 64;
const META_SIZE  = 28;
const LINE_H     = MSG_SIZE * 1.4;
const PAD_TOP    = 72;
const META_GAP   = 36;
const BOTTOM_PAD = 90;   // headroom for drips below metadata

const PARAMS = {
  dripLength:   0.30,
  columnScale:  5.5,
  columnBias:   0.1,
  falloffPow:   1.4,
  streamSharp:  2.2,
  wobbleAmp:    0.106,
  wobbleFreq:   1.5,
  wobbleSpeed:  0.1,
  flowSpeed:    0.3,
  dripsSpeed:   0.20,
  aberration:   0.1,
  energy:       0.18,
  energyScale:  0.5,
  glow:         0.10,
  aqiMax:       300.0,
  aqiInfluence: 0.35,
  effectScale:  1.0,
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

// ─── Fragment shader ─────────────────────────────────────────────────────────
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
    float aspect = resolution.x / resolution.y;

    float colWide   = fbm(vec2(uv.x * columnScale        + time * flowSpeed,        31.0));
    float colNarrow = fbm(vec2(uv.x * columnScale * 2.8  + time * flowSpeed * 0.55 + 7.3, 17.5));
    float colStr    = mix(columnBias, 1.0, colWide) * pow(colNarrow, streamSharp);

    float flowN = fbm(vec2(uv.x * columnScale + time * flowSpeed * 0.25,
                           uv.y * 2.2         - time * dripsSpeed));
    float disp  = heat * dripLength * colStr * (0.4 + 0.6 * flowN);

    float wn     = fbm(vec2(uv.x * wobbleFreq * aspect + time * wobbleSpeed, uv.y * 2.5));
    float wobble = (wn - 0.5) * 2.0 * wobbleAmp * heat;

    vec2 dispVec = vec2(wobble, -disp);
    float sep = energy * energyScale * 0.04;
    vec2 uvG = uv + dispVec;
    vec2 uvR = uv + dispVec * (1.0 - aberration) + vec2(0.0,  sep);
    vec2 uvB = uv + dispVec * (1.0 + aberration) - vec2(0.0,  sep);

    float r = texture2D(tex0, uvR).r;
    float g = texture2D(tex0, uvG).g;
    float b = texture2D(tex0, uvB).b;

    float normDisp = clamp(disp / (heat * dripLength + 0.001), 0.0, 1.0);
    float falloff  = 1.0 - pow(normDisp, falloffPow);
    vec3 drip = vec3(r, g, b) * falloff;
    vec3 col  = min(drip + drip * glow, vec3(1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function measureCardHeight(text, maxW) {
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  ctx.font = `bold ${MSG_SIZE}px ${FONT}`;
  let lines = 0;
  for (const para of text.split('\n')) {
    if (!para) { lines++; continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines++; line = word; }
      else line = test;
    }
    lines++;
  }
  return PAD_TOP + Math.max(lines, 1) * LINE_H + META_GAP + META_SIZE * 1.4 + BOTTOM_PAD;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.getHours().toString().padStart(2, '0') + ':' +
         d.getMinutes().toString().padStart(2, '0');
}

function wrapText(ctx, text, x, y, maxW) {
  let cy = y;
  for (const para of text.split('\n')) {
    if (!para) { cy += LINE_H; continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, cy); line = word; cy += LINE_H;
      } else line = test;
    }
    ctx.fillText(line, x, cy);
    cy += LINE_H;
  }
  return cy;
}

// ─── Per-message p5 instance ──────────────────────────────────────────────────
function createMessageSketch(msg, container, W) {
  const maxW  = W * 0.88;
  const cardH = Math.ceil(measureCardHeight(msg.text, maxW));
  const heat  = Math.min(
    (msg.aqi / PARAMS.aqiMax) * PARAMS.aqiInfluence * PARAMS.effectScale,
    1
  );

  // p5 is loaded as a global from the script tag
  // eslint-disable-next-line no-undef
  new p5((p) => {
    let pg, meltShader;
    let t = 0;

    p.setup = () => {
      p.createCanvas(W, cardH, p.WEBGL);
      p.pixelDensity(window.devicePixelRatio || 1);

      pg = p.createGraphics(p.width, p.height);
      pg.pixelDensity(p.pixelDensity());

      // Render text content once into pg (static texture for the shader)
      const ctx    = pg.drawingContext;
      const margin = p.width * 0.055;
      // maxW already computed above via W, but recalculate for actual canvas width
      const maxW   = p.width * 0.88;

      pg.background(0);
      ctx.textBaseline = 'top';
      ctx.textAlign    = 'left';
      ctx.font         = `bold ${MSG_SIZE}px ${FONT}`;
      ctx.fillStyle    = '#ffffff';
      const textEndY   = wrapText(ctx, msg.text, margin, PAD_TOP, maxW);

      ctx.font      = `${META_SIZE}px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        `${formatTime(msg.timestamp)}, ${msg.city}, AQI ${msg.aqi}`,
        margin,
        textEndY + META_GAP
      );

      meltShader = p.createShader(MELT_VERT, MELT_FRAG);
    };

    p.draw = () => {
      t += p.deltaTime / 1000;

      p.shader(meltShader);
      meltShader.setUniform('tex0',        pg);
      meltShader.setUniform('time',        t);
      meltShader.setUniform('heat',        heat);
      meltShader.setUniform('resolution',  [p.width, p.height]);
      meltShader.setUniform('dripLength',  PARAMS.dripLength);
      meltShader.setUniform('columnScale', PARAMS.columnScale);
      meltShader.setUniform('columnBias',  PARAMS.columnBias);
      meltShader.setUniform('falloffPow',  PARAMS.falloffPow);
      meltShader.setUniform('streamSharp', PARAMS.streamSharp);
      meltShader.setUniform('wobbleAmp',   PARAMS.wobbleAmp);
      meltShader.setUniform('wobbleFreq',  PARAMS.wobbleFreq);
      meltShader.setUniform('wobbleSpeed', PARAMS.wobbleSpeed);
      meltShader.setUniform('flowSpeed',   PARAMS.flowSpeed);
      meltShader.setUniform('dripsSpeed',  PARAMS.dripsSpeed);
      meltShader.setUniform('aberration',  PARAMS.aberration);
      meltShader.setUniform('energy',      PARAMS.energy);
      meltShader.setUniform('energyScale', PARAMS.energyScale);
      meltShader.setUniform('glow',        PARAMS.glow);
      p.noStroke();
      p.rect(-p.width / 2, -p.height / 2, p.width, p.height);
    };
  }, container);
}

// ─── Init & refresh ───────────────────────────────────────────────────────────
async function init() {
  // Wait one animation frame so the browser has computed layout and
  // window.innerWidth / container.clientWidth reflect actual viewport size.
  await new Promise(resolve => requestAnimationFrame(resolve));

  const messagesEl = document.getElementById('messages');
  const knownIds   = new Set();

  async function refresh() {
    const msgs = await fetch('/api/messages').then(r => r.json()).catch(() => []);

    if (msgs.length === 0 && knownIds.size === 0) {
      if (!document.getElementById('empty-msg')) {
        const el = document.createElement('p');
        el.id = 'empty-msg';
        el.style.cssText = [
          'color:#555',
          'font-family:"SF Mono",Menlo,"Courier New",monospace',
          'font-size:28px',
          'padding:0 5.5vw',
          'line-height:1.5',
        ].join(';');
        el.textContent = 'no entries yet';
        messagesEl.appendChild(el);
      }
      return;
    }

    const emptyEl = document.getElementById('empty-msg');
    if (emptyEl) emptyEl.remove();

    // Capture viewport width once for this refresh pass
    const W = document.documentElement.clientWidth || window.innerWidth;

    for (const msg of msgs) {
      if (knownIds.has(msg.id)) continue;
      knownIds.add(msg.id);
      const card = document.createElement('div');
      messagesEl.insertBefore(card, messagesEl.firstChild);
      createMessageSketch(msg, card, W);
    }
  }

  await refresh();
  setInterval(refresh, 3_000);
}

init();
