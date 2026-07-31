/* Ashlar — a grid-set plate background in depth-banded parallax. The second of the two procedural
 * backgrounds added 2026-07-30; the CONSTRUCTED counterpart to `terrace`'s organic landform.
 * UMD: sets globalThis.INTERCEPT_ASHLAR in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG — load it first.
 *
 * THE IDEA: ashlar is dressed, squared masonry — stone cut to a module and laid in courses. Here the
 * module is a Swiss 12-column grid: every plate's position AND size is a whole number of grid units,
 * so nothing is arbitrary and the field reads as constructed rather than scattered. Three depth bands
 * then parallax at different amplitudes, which gives architectural depth from nothing but flat shapes.
 * Where keyline is drawn line and terrace is poured tone, ashlar is placed mass.
 *
 * WHY THIS IS NOT A SET OF RULE LINES: plates are areas on a module, never 1-2px strokes, and nothing
 * is centred under or beside type as an underline/divider/accent. Jon's standing ban is on decorative
 * RULE LINES; a grid-set field of masses is texture, and the thinnest plate here is a full grid unit.
 *
 * TRIANGLES FOLLOW THE FRITZ RULE: apex-UP with the right angle ON THE BASE, and lean is a horizontal
 * MIRROR only — never a rotation. (Same constraint fritzoid's triVerts encodes.) They are patterning
 * here, which is the explicit exception to "the mark is never decoration" — these are plain geometric
 * plates on a grid, not the 8-path Intercept mark.
 *
 * INK-FIRST, near-neutral BY CONSTRUCTION: one on-token ink per ground, painted at a per-depth flat
 * alpha, so the whole field lives on one tonal axis and the ink-discipline gate holds without a palette
 * table. Measured max channel spread over every rendered pixel is 5 — inherited from the carbon token
 * #0a0a0f being very slightly blue (10,10,15) — against the gate's ceiling of 24. Same construction as
 * terrace, same ink-first precedent as fritzoid. Plates in the SAME depth band never overlap (see the
 * occupancy grid below), so a band's tone is laid down exactly once and the band tones stay equal steps
 * apart rather than compounding.
 *
 * SEAMLESS LOOP: each plate's parallax offset is A*sin(2*PI*n*tN) with INTEGER n — an endpoint-zero
 * form, so it is EXACTLY 0 at tN=0 and at tN=1. Nothing persists across frames. That is the same
 * construction composer.js's floatTransform and pulseTransform use, and it means the plate is back
 * precisely where it started at the seam with zero velocity discontinuity — a sine there is also what
 * keeps the motion from landing hard (Jon's easing rule: sine ease, long durations, no jarring
 * landings).
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_ASHLAR = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';

  const TAU = Math.PI * 2;

  // One ink per ground; both are ON_TOKEN_HEX entries. Composited over the ground at a flat alpha,
  // every pixel lands on the neutral grey axis.
  const INK = { halo: '#0a0a0f', carbon: '#ffffff' };

  // The module. 12 columns is the Swiss/Bauhaus default and divides cleanly into every shipped ratio.
  const COLS = 12;

  // Three depth bands, far -> near. `alphaOf` is a fraction of the style's inkAlpha so a preset moves
  // all three together; the fractions are EQUAL steps (1/3, 2/3, 3/3) per the hard-steps rule.
  const BANDS = [
    { alphaOf: 1 / 3, parallax: 0.35 },
    { alphaOf: 2 / 3, parallax: 0.70 },
    { alphaOf: 3 / 3, parallax: 1.00 },
  ];

  const DEFAULTS = {
    plates: 11,      // total plates across all three bands
    inkAlpha: 0.10,  // alpha of the NEAREST band; farther bands step down from it
    drift: 1,        // multiplier on the parallax amplitude (0 = a still composition)
    triShare: 0.3,   // fraction of plates drawn as apex-up triangles rather than rectangles
  };

  function clampInt(v, lo, hi, dflt) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function num(v, dflt) {
    const n = Number(v);
    return Number.isFinite(n) ? n : dflt;
  }

  /* buildAshlar(spec, m) -> state. All seeding and placement happens ONCE here; the draw call only
   * evaluates the parallax sines. Scalars (plates/inkAlpha/drift/triShare) ride in through
   * mergeMotion's style-agnostic passthrough, exactly like fritzoid's and terrace's.
   */
  function buildAshlar(spec, m) {
    const W = spec.size.w, H = spec.size.h;
    const ground = (spec.bg === 'carbon') ? 'carbon' : 'halo';
    const count = clampInt(m.plates, 3, 40, DEFAULTS.plates);
    const inkAlpha = num(m.inkAlpha, DEFAULTS.inkAlpha);
    const drift = num(m.drift, DEFAULTS.drift);
    const triShare = Math.max(0, Math.min(1, num(m.triShare, DEFAULTS.triShare)));
    // Seed is salted with a per-style constant so ashlar and terrace never derive the same sequence
    // from a shared motion.seed.
    const rand = E.rng(((m.seed >>> 0) ^ 0x0a54a12) >>> 0);

    const unit = W / COLS;                       // one grid module, in px
    const rows = Math.max(4, Math.round(H / unit)); // square modules => row count follows the ratio

    // Per-band occupancy so same-band plates never overlap: a plate's tone must be laid down exactly
    // once or the band tones stop being equal steps. Cross-band overlap is WANTED (that is the depth
    // read), so occupancy is tracked per band, not globally.
    const occupied = BANDS.map(() => new Set());
    const key = (c, r) => c + ':' + r;
    function freeAt(band, c0, r0, w, h) {
      for (let c = c0; c < c0 + w; c++) {
        for (let r = r0; r < r0 + h; r++) if (occupied[band].has(key(c, r))) return false;
      }
      return true;
    }
    function claim(band, c0, r0, w, h) {
      for (let c = c0; c < c0 + w; c++) {
        for (let r = r0; r < r0 + h; r++) occupied[band].add(key(c, r));
      }
    }

    // Bleed the field one module past every edge so plates are cropped by the frame rather than
    // floating inside it — cropped mass is what makes a composition feel larger than the canvas.
    const C_MIN = -1, C_MAX = COLS + 1, R_MIN = -1, R_MAX = rows + 1;

    // STRATIFIED placement, not uniform-random. Purely random (c0,r0) leaves the coverage to luck: on
    // some seeds the plates bunch into a diagonal and whole corners come out bare, which reads as
    // scatter rather than a laid wall. Instead the field is cut into a lattice of zones and plates are
    // dealt one per zone in a shuffled order, so every seed spreads across the frame. Cycling the deck
    // when there are more plates than zones keeps that spread as density rises with the preset.
    const ZC = 4;                                        // zone columns
    const ZR = Math.max(3, Math.round(rows / 3));        // zone rows, following the ratio
    const zones = [];
    for (let zc = 0; zc < ZC; zc++) for (let zr = 0; zr < ZR; zr++) zones.push([zc, zr]);
    for (let i = zones.length - 1; i > 0; i--) {         // seeded Fisher-Yates
      const j = Math.floor(rand() * (i + 1));
      const tmp = zones[i]; zones[i] = zones[j]; zones[j] = tmp;
    }
    const zoneW = (C_MAX - C_MIN) / ZC, zoneH = (R_MAX - R_MIN) / ZR;

    const plates = [];
    let guard = 0, dealt = 0;
    while (plates.length < count && guard++ < count * 40) {
      const band = Math.floor(rand() * BANDS.length);
      // Nearer bands run larger — the other half of the depth read, alongside alpha and parallax.
      const maxW = band === 2 ? 4 : (band === 1 ? 3 : 2);
      const w = 1 + Math.floor(rand() * maxW);
      const h = 1 + Math.floor(rand() * (maxW + 1));
      // Deal the next zone and land the plate inside it.
      const z = zones[dealt % zones.length];
      const zx = C_MIN + z[0] * zoneW, zy = R_MIN + z[1] * zoneH;
      const c0 = Math.round(zx + rand() * Math.max(0, zoneW - w));
      const r0 = Math.round(zy + rand() * Math.max(0, zoneH - h));
      if (!freeAt(band, c0, r0, w, h)) continue;   // retry the SAME zone with fresh dice
      dealt++;
      claim(band, c0, r0, w, h);

      const isTri = rand() < triShare;
      plates.push({
        band,
        kind: isTri ? 'tri' : 'rect',
        lean: rand() < 0.5 ? 'left' : 'right',   // triangles: horizontal MIRROR only, never a rotation
        x: c0 * unit,
        y: r0 * unit,
        w: w * unit,
        h: h * unit,
        // Parallax: integer temporal harmonics => endpoint-zero at BOTH seams. Amplitude is a fraction
        // of a module so plates travel along the grid rather than wandering off it.
        ax: unit * (0.18 + rand() * 0.30) * BANDS[band].parallax * drift,
        ay: unit * (0.12 + rand() * 0.26) * BANDS[band].parallax * drift,
        nx: 1 + Math.floor(rand() * 2),
        ny: 1 + Math.floor(rand() * 2),
        sx: rand() < 0.5 ? -1 : 1,
        sy: rand() < 0.5 ? -1 : 1,
      });
    }

    // Far -> near so nearer (stronger) plates land on top; the paint order IS the depth order.
    plates.sort((a, b) => a.band - b.band);

    return { W, H, ground, unit, rows, plates, inkAlpha, ink: INK[ground] };
  }

  /* Apex-up right triangle inscribed in the plate box, right angle ON the base, lean by MIRROR only.
   * left  -> right angle at bottom-LEFT,  apex above it   (vertical leg on the left)
   * right -> right angle at bottom-RIGHT, apex above it   (vertical leg on the right)
   * Canvas y grows downward, so the apex is the smallest y.
   */
  function traceTriangle(ctx, x, y, w, h, lean) {
    ctx.beginPath();
    if (lean === 'left') {
      ctx.moveTo(x, y);             // apex (top of the left vertical leg)
      ctx.lineTo(x, y + h);         // right angle, on the base
      ctx.lineTo(x + w, y + h);     // base run
    } else {
      ctx.moveTo(x + w, y);         // apex (top of the right vertical leg)
      ctx.lineTo(x + w, y + h);     // right angle, on the base
      ctx.lineTo(x, y + h);         // base run
    }
    ctx.closePath();
  }

  /* drawAshlarBackground / drawAshlarAt: pure canvas 2D API (fillRect / paths / globalAlpha) — no DOM,
   * no offscreen canvas, no CSS, so it renders identically under node-canvas and Chrome.
   */
  function drawAshlarBackground(ctx, state, t) {
    const loopSec = state.loopSec || 8;
    drawAshlarAt(ctx, state, ((t / loopSec) % 1 + 1) % 1);
  }

  function drawAshlarAt(ctx, state, tN) {
    const { W, H } = state;
    ctx.save();
    ctx.fillStyle = (state.ground === 'carbon') ? '#0a0a0f' : '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = state.ink;
    for (let i = 0; i < state.plates.length; i++) {
      const p = state.plates[i];
      // Endpoint-zero parallax: exactly 0 at tN=0 and tN=1 for any integer harmonic.
      const dx = p.ax * p.sx * Math.sin(TAU * p.nx * tN);
      const dy = p.ay * p.sy * Math.sin(TAU * p.ny * tN);
      ctx.globalAlpha = state.inkAlpha * BANDS[p.band].alphaOf;
      const x = p.x + dx, y = p.y + dy;
      if (p.kind === 'tri') {
        traceTriangle(ctx, x, y, p.w, p.h, p.lean);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, p.w, p.h);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return { buildAshlar, drawAshlarBackground, drawAshlarAt, traceTriangle, DEFAULTS, BANDS, COLS, INK };
});
