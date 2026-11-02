// Живая Земля на первом экране: WebGL2 без библиотек. Ночная сторона, города России (настоящие
// координаты), атмосфера, рассвет. Прокрутка не захватывается: она лишь ведёт камеру с орбиты
// вниз, к восходу над Уфой, а в конце свет вливается в цвет страницы.
// Там, где WebGL не тянет, остаётся постер: кадры этого же шейдера, запечённые в картинки.

const MAP = { lon0: 15, lon1: 150, lat0: 35, lat1: 75 }; // tools/earth-lights.py
const UFA = [54.73, 55.96];
const rad = (d) => (d * Math.PI) / 180;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D tLights, tNoise;
uniform vec2 uRes;
uniform vec3 uCenter, uSun, uUfa, uPage;
uniform mat3 uGeo;
uniform float uTime, uTan, uPitch, uRoll, uDawn, uAir, uWhite, uBeacon;
uniform vec4 uComet;
out vec4 outColor;

const float ATM = .05;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// Слои атмосферы на просвет: у самой земли красный, выше золото, затем голубой
vec3 ramp(float a) {
  vec3 c0 = vec3(1., .22, .04), c1 = vec3(1., .63, .28), c2 = vec3(.36, .66, 1.), c3 = vec3(.05, .13, .4);
  if (a < .16) return mix(c0, c1, a / .16);
  if (a < .4) return mix(c1, c2, (a - .16) / .24);
  return mix(c2, c3, (a - .4) / .6);
}

vec3 starLayer(vec3 rd, float scale, float keep, float gain, float sharp) {
  vec2 q = rd.xy / (1.2 - rd.z) * scale;
  vec2 id = floor(q), f = fract(q) - .5;
  float h = hash(id);
  if (h < keep) return vec3(0.);
  vec2 off = (vec2(hash(id + 7.1), hash(id + 3.7)) - .5) * .8;
  float s = (h - keep) / (1. - keep);
  float d = length(f - off);
  float tw = .8 + .2 * sin(uTime * (.7 + h * 1.6) + h * 40.);
  return mix(vec3(.7, .82, 1.), vec3(1., .9, .78), hash(id + 1.3)) * exp(-d * d * sharp) * s * s * s * tw * gain;
}
vec3 stars(vec3 rd) {
  return starLayer(rd, 620., .978, .9, 110.) + starLayer(rd + .31, 240., .993, 1.5, 90.);
}

vec3 tone(vec3 c) {
  const float start = .76;
  float x = min(c.r, min(c.g, c.b));
  c -= x < .08 ? x - 6.25 * x * x : .04;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < start) return c;
  float d = 1. - start;
  float np = 1. - d * d / (peak + d - start);
  c *= np / peak;
  return mix(c, vec3(np), 1. - 1. / (.15 * (peak - np) + 1.));
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2. - 1.;
  float cr = cos(uRoll), sr = sin(uRoll);
  vec2 v2 = vec2(ndc.x * uTan * uRes.x / uRes.y, ndc.y * uTan);
  vec3 rd = normalize(vec3(cr * v2.x - sr * v2.y, sr * v2.x + cr * v2.y, -1.));
  float cp = cos(uPitch), sp = sin(uPitch);
  rd = vec3(rd.x, cp * rd.y - sp * rd.z, sp * rd.y + cp * rd.z);

  vec3 ro = -uCenter;
  float b = dot(ro, rd);
  vec3 tangent = ro - rd * b;
  float dist = length(tangent);
  float alt = (dist - 1.) / ATM;
  float px = max(fwidth(alt), 1e-4);
  float earth = b < 0. ? smoothstep(px, -px, alt) : 0.;
  vec3 tn = tangent / dist;
  float sa = dot(tn, uSun);
  float cs = max(dot(rd, uSun), 0.);
  float h = max(alt, 0.);

  float lit = smoothstep(-.36 - .24 * min(h, 1.), .04, sa);
  float forward = pow(cs, 90.) * 3.6 + pow(cs, 9.) * .42;
  vec3 atmos = ramp(min(h, 1.)) * exp(-h * 3.1) * lit * lit * (.72 + forward * 2.);
  atmos += vec3(.03, .1, .26) * exp(-h * 4.4) * .62;

  vec3 surf = vec3(0.);
  if (earth > 0.) {
    float c = dot(ro, ro) - 1.;
    float t = -b - sqrt(max(b * b - c, 0.));
    vec3 n = normalize(ro + rd * t);
    float mu = max(dot(n, -rd), 0.);
    vec3 q = uGeo * n;
    float lat = asin(clamp(q.y, -1., 1.));
    float lon = atan(q.x, q.z);
    vec2 uv = (vec2(lon, lat) * 57.29578 - vec2(${MAP.lon0}., ${MAP.lat0}.)) / vec2(${MAP.lon1 - MAP.lon0}., ${MAP.lat1 - MAP.lat0}.);
    vec3 lights = texture(tLights, uv).rgb;
    lights *= step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
    // Россыпь вместо пятен: мелкая фактура разбивает свет на отдельные огни
    float speck = texture(tNoise, uv * vec2(46., 19.)).g;
    lights *= .35 + 1.5 * smoothstep(.3, .72, speck);

    vec2 cuv = vec2(lon * 1.1, lat * 2.2);
    float c1 = texture(tNoise, cuv + vec2(uTime * .0012, 0.)).r;
    float c2 = texture(tNoise, cuv * 3.3 + vec2(.37, uTime * .002)).g;
    float cloud = smoothstep(.46, .78, c1 * .72 + c2 * .28);

    float ndl = dot(n, uSun);
    float day = smoothstep(-.1, .16, ndl);
    vec3 ground = mix(vec3(.02, .035, .05), vec3(.05, .06, .045), c2);
    vec3 tint = mix(vec3(1., .42, .16), vec3(1., .93, .82), smoothstep(0., .35, ndl));
    vec3 dayc = mix(ground, vec3(.92, .94, 1.), cloud) * tint * max(ndl + .04, 0.) * 7.;
    vec3 night = vec3(.011, .019, .036) * cloud + vec3(.0018, .0036, .0082);
    night += lights * lights * 1.9 * (1. - .7 * cloud) * (1. - uAir);
    surf = mix(night, dayc, day);

    float rim = pow(1. - mu, 4.);
    vec3 haze = mix(vec3(.05, .13, .3) * .32, ramp(.22 + .24 * (1. - rim)) * lit * lit * (1. + forward), clamp(lit * 1.25, 0., 1.));
    surf = mix(surf, haze, rim * .86);

    float d = acos(clamp(dot(n, uUfa), -1., 1.));
    float ping = fract(uTime * .2);
    surf += vec3(.55, .94, 1.) * uBeacon * (exp(-pow(d / .0028, 2.)) * 3. + exp(-pow((d - ping * .022) / .0016, 2.)) * pow(1. - ping, 2.) * .55);
  }

  vec3 col = mix(atmos + stars(rd) * (1. - uDawn) * (1. - exp(-h * 2.)), surf, earth);

  float sd = acos(clamp(dot(rd, uSun), -1., 1.));
  float open = 1. - earth;
  col += vec3(1., .97, .9) * smoothstep(.0165, .0125, sd) * 240. * open;
  col += vec3(1., .85, .64) * (exp(-sd * 60.) * 7. + exp(-sd * 15.) * .8) * open * uDawn;
  // Снижение: космос сменяется голубым небом, поверхность тонет в утренней дымке
  float up = clamp(rd.y * 2.4 + .25, 0., 1.);
  vec3 sky = mix(vec3(.5, .72, .98), vec3(.07, .2, .52), up);
  sky = mix(sky, vec3(.86, .92, 1.), uAir * uAir * uAir);
  col = mix(col, sky * (.35 + .65 * uAir) + vec3(1., .8, .55) * exp(-sd * 3.2) * .9 * uAir, smoothstep(0., .7, uAir) * open);
  col = mix(col, mix(vec3(.62, .72, .86), vec3(1., .92, .8), exp(-sd * 2.4)), uAir * uAir * earth * .9);

  if (uComet.w > 0.) {
    vec2 a = ndc * vec2(uRes.x / uRes.y, 1.) - uComet.xy;
    vec2 dir = normalize(vec2(-.9, -.42));
    float along = dot(a, dir);
    float across = abs(dot(a, vec2(-dir.y, dir.x)));
    float tail = along < 0. ? exp(along * 9.) : 0.;
    col += vec3(.75, .92, 1.) * uComet.w * (exp(-dot(a, a) * 9000.) * 7. + tail * exp(-across * across * (26000. + along * along * -160000.)) * 1.5) * open;
  }

  col = tone(col);
  col = pow(clamp(col, 0., 1.), vec3(1. / 2.2));
  col += (hash(gl_FragCoord.xy * .013 + fract(uTime)) - .5) * .012;
  outColor = vec4(mix(col, uPage, uWhite), 1.);
}`;

// Бесшовный шум 256×256 для облаков: считается один раз и не весит ни байта в сети
function noiseData(size) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const channels = [4, 4].map((first) => {
    const out = new Float32Array(size * size);
    let amp = 1;
    for (let f = first; f <= size / 4; f *= 2) {
      const g = new Float32Array(f * f).map(rnd);
      for (let y = 0; y < size; y++) {
        const v = (y / size) * f, y0 = v | 0, ty = v - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % f;
        for (let x = 0; x < size; x++) {
          const u = (x / size) * f, x0 = u | 0, tx = u - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % f;
          const a = g[y0 * f + x0], b = g[y0 * f + x1], c = g[y1 * f + x0], d = g[y1 * f + x1];
          out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        }
      }
      amp *= 0.55;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of out) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return out.map((v) => (v - lo) / (hi - lo));
  });
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = channels[0][i] * 255;
    data[i * 4 + 1] = channels[1][i] * 255;
    data[i * 4 + 3] = 255;
  }
  return data;
}

// Положение камеры и Земли: прокрутка p ведёт с орбиты к восходу
function view(p, aspect) {
  const fall = smooth(0, 1, p);
  const D = mix(1.556, 1.1, fall);
  const alpha = Math.asin(1 / D);
  const portrait = aspect < 1;
  // Вершина дуги: на широком экране чуть ниже центра, на телефоне ближе к низу
  const halfH = portrait ? 25 : 25.5;
  const vtan = Math.min(Math.tan(rad(halfH)) / aspect, Math.tan(rad(32)));
  const apexScreen = (portrait ? -0.56 : -0.1) + fall * (portrait ? 0.46 : 0.12);
  const pitch = rad(-3);
  const apex = pitch + Math.atan(apexScreen * vtan);
  const el = apex - alpha;
  const center = [0, Math.sin(el) * D, -Math.cos(el) * D];
  // Широта точки под камерой: с приближением разворачиваемся к Уфе
  const subLat = mix(portrait ? 28 : 25, 44, fall);
  const subLon = mix(portrait ? 58 : 41, 56, fall);
  const roll = rad(mix(portrait ? 5 : 8.5, 0, smooth(0.05, 0.75, p)));
  const psi = mix(alpha * 57.29578 - 12.5, alpha * 57.29578 + 2.2, smooth(0.08, 0.86, p));
  return { D, alpha, vtan, pitch, roll, center, el, subLat, subLon, psi, fall };
}

function geoMatrix(center, subLat, subLon) {
  const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const Ws = norm(center.map((x) => -x));
  const Wn = norm([0 - Ws[0] * Ws[1], 1 - Ws[1] * Ws[1], 0 - Ws[2] * Ws[1]]);
  const We = cross(Wn, Ws);
  const la = rad(subLat), lo = rad(subLon);
  const s = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  const n = norm([-s[0] * s[1], 1 - s[1] * s[1], -s[2] * s[1]]);
  const e = cross(n, s);
  const m = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) m.push(e[i] * We[j] + n[i] * Wn[j] + s[i] * Ws[j]);
  const toWorld = (lat, lon) => {
    const a = rad(lat), o = rad(lon);
    const q = [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)];
    const de = dot(q, e), dn = dot(q, n), ds = dot(q, s);
    return [0, 1, 2].map((k) => We[k] * de + Wn[k] * dn + Ws[k] * ds);
  };
  return { m, toWorld, Wn, We };
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

export function createEarth(canvas, lightsImage, { page = [0.957, 0.945, 0.925] } = {}) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  ['tLights', 'tNoise', 'uRes', 'uCenter', 'uSun', 'uUfa', 'uPage', 'uGeo', 'uTime', 'uTan', 'uPitch', 'uRoll', 'uDawn', 'uAir', 'uWhite', 'uBeacon', 'uComet'].forEach((n) => { u[n] = gl.getUniformLocation(prog, n); });

  const lights = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, lights);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, lightsImage);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

  const noise = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, noise);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noiseData(256));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

  gl.uniform1i(u.tLights, 0);
  gl.uniform1i(u.tNoise, 1);
  gl.uniform3fv(u.uPage, page);

  let width = 2, height = 2;
  const resize = (w, h) => {
    width = canvas.width = Math.max(2, Math.round(w));
    height = canvas.height = Math.max(2, Math.round(h));
    gl.viewport(0, 0, width, height);
  };

  const draw = (p, time) => {
    const aspect = width / height;
    const v = view(p, aspect);
    const geo = geoMatrix(v.center, v.subLat, v.subLon);
    const a = rad(v.psi), az = rad(3);
    const dir = v.center.map((x) => x / v.D);
    const sun = [0, 1, 2].map((k) => dir[k] * Math.cos(a) + (geo.Wn[k] * Math.cos(az) + geo.We[k] * Math.sin(az)) * Math.sin(a));
    const dawn = smooth(0.15, 0.78, p);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform3fv(u.uCenter, v.center);
    gl.uniform3fv(u.uSun, sun);
    gl.uniform3fv(u.uUfa, geo.toWorld(UFA[0], UFA[1]));
    gl.uniformMatrix3fv(u.uGeo, false, geo.m);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uTan, v.vtan);
    gl.uniform1f(u.uPitch, v.pitch);
    gl.uniform1f(u.uRoll, v.roll);
    gl.uniform1f(u.uDawn, dawn);
    gl.uniform1f(u.uAir, smooth(0.5, 0.92, p));
    gl.uniform1f(u.uWhite, smooth(0.8, 1, p));
    gl.uniform1f(u.uBeacon, 1 - smooth(0.25, 0.6, p));
    // Комета раз в 26 секунд: тонкая и быстрая, как настоящий метеор
    const cycle = (time % 26) / 1.5;
    const asp = aspect;
    if (cycle < 1) gl.uniform4f(u.uComet, mix(0.9, -0.1, cycle) * asp, mix(0.86, 0.5, cycle), 0, Math.sin(cycle * Math.PI) * (1 - dawn));
    else gl.uniform4f(u.uComet, 0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const destroy = () => {
    gl.deleteTexture(lights);
    gl.deleteTexture(noise);
    gl.deleteBuffer(buf);
    gl.deleteProgram(prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };

  return { resize, draw, destroy, get size() { return [width, height]; } };
}
