/* Terrace — a quantized contour-plateau background. One of the two procedural backgrounds added
 * 2026-07-30 alongside `ashlar`, siblings to `keyline` (spiral line ribbons) and `fritzoid` (ambient
 * truchet tile field).
 * UMD: sets globalThis.INTERCEPT_TERRACE in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG — load it first.
 *
 * THE IDEA: Jon's standing brand rule is that "no gradients" means HARD-EDGED STEPS — 3 to 9 equal
 * ones — never a smooth grade. Terrace takes that rule and makes it the generator: a soft, organic
 * landform is sliced into N equal tonal plateaus with knife edges. The result reads like a
 * topographic map or a stepped model-maker's contour stack — atmospheric shapes, zero softness.
 *
 * INK-FIRST, and near-neutral BY CONSTRUCTION: every plateau is the SAME single on-token ink painted at
 * a different alpha over the ground, so the whole field lives on one tonal axis and the ink-discipline
 * gate is satisfied without needing a palette table. Measured max channel spread over every rendered
 * pixel is 5 — inherited from the carbon token #0a0a0f itself, which is very slightly blue (10,10,15) —
 * against the gate's ceiling of 24. (Not literally 0: nothing here can introduce a hue that the two
 * ground tokens don't already carry.) Follows fritzoid's ink-first precedent (Jon, 07-29: "fritzoid has
 * a colored glitch in its animation. remove this.") — no channel hues anywhere in this module.
 *
 * EQUAL steps, not compounding ones: each plateau is drawn ONCE as a true ANNULUS (its own ring path
 * plus the next ring as an even-odd hole), never as a stack of overlapping translucent discs. Painting
 * one flat alpha over the ground gives tone = ground*(1-a) + ink*a, which is LINEAR in a — so a linear
 * alpha ramp across the levels yields genuinely equal tonal steps. Overlapping discs would compound
 * geometrically and the steps would bunch toward the middle.
 *
 * SEAMLESS LOOP: every quantity is a pure function of tN = (t / loopSec) % 1 with no persisted state.
 * Ring radii use cos(m*theta + phase + 2*PI*n*tN) and the shared centre drift uses sin(2*PI*n*tN),
 * both with INTEGER n — so tN=1 reproduces tN=0 exactly (same house rule as engine.js's keyline
 * motion, composer.js's floatTransform and fritzoid's tile parity).
 *
 * NESTING IS PROVEN, NOT HOPED FOR: crossed rings would tear holes in the annuli, so the radii are
 * built so they can never cross. Level L sits at R_L = maxR*(1 - L/steps) — uniform gap `g` apart —
 * and wobbles by at most A = 0.42*g. Then max(r_{L+1}) = R_L - g + A < R_L - A = min(r_L) whenever
 * A < g/2, which 0.42*g satisfies with margin. The per-level phases differ (so the plateaus meander
 * independently and the field looks organic) but the amplitude bound holds regardless of phase, and
 * the centre drift is SHARED by every level so it can never change their relative order.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_TERRACE = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';

  const TAU = Math.PI * 2;

  // The single ink per ground. Both are ON_TOKEN_HEX entries, and because every plateau composites
  // this one ink over the ground at a flat alpha, every resulting pixel is a neutral grey.
  const INK = { halo: '#0a0a0f', carbon: '#ffffff' };

  // Hard-edged-steps rule: 3..9 equal steps. Anything outside that is clamped, never honoured.
  const MIN_STEPS = 3;
  const MAX_STEPS = 9;

  // Ring resolution. 240 samples keeps the contour curves clean at 1080-2000px without the vertex
  // count mattering: the whole field is ~steps*240 cos evaluations per frame.
  const RING_SAMPLES = 240;

  // Wobble amplitude as a fraction of the inter-level gap. MUST stay < 0.5 — that is the entire
  // nesting proof in the header. 0.42 leaves visible meander with margin to spare.
  const WOBBLE_OF_GAP = 0.42;

  const DEFAULTS = {
    steps: 6,        // tonal plateaus (clamped to 3..9)
    inkAlpha: 0.10,  // alpha of the DEEPEST plateau; levels ramp linearly up to it
    spread: 0.55,    // outermost radius as a fraction of the frame diagonal
    relief: 1,       // multiplier on the wobble amplitude (0 = perfect circles)
    drift: 1,        // multiplier on the shared centre drift
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

  /* buildTerrace(spec, m) -> state. Everything seeded and time-independent is resolved ONCE here;
   * drawTerraceBackground then only evaluates the time-varying parts. `m` is composer.js's merged
   * motion object, so terrace's scalars (steps/inkAlpha/spread/relief/drift) arrive through
   * mergeMotion's style-agnostic passthrough exactly like fritzoid's tileBase/wavesPerLoop/inkAlpha.
   */
  function buildTerrace(spec, m) {
    const W = spec.size.w, H = spec.size.h;
    const ground = (spec.bg === 'carbon') ? 'carbon' : 'halo';
    const steps = clampInt(m.steps, MIN_STEPS, MAX_STEPS, DEFAULTS.steps);
    const inkAlpha = num(m.inkAlpha, DEFAULTS.inkAlpha);
    const spread = num(m.spread, DEFAULTS.spread);
    const relief = num(m.relief, DEFAULTS.relief);
    const drift = num(m.drift, DEFAULTS.drift);
    // Seed is salted with a per-style constant so terrace and ashlar never derive the same sequence
    // from a shared motion.seed.
    const rand = E.rng(((m.seed >>> 0) ^ 0x7e44ace) >>> 0);

    const diag = Math.sqrt(W * W + H * H);
    const maxR = diag * spread;
    const gap = maxR / steps;
    const wobble = gap * WOBBLE_OF_GAP * Math.max(0, Math.min(1, relief));

    // Centre is deliberately OFF-centre and pushed past the frame's middle so the outer plateaus clip
    // the edges — that is what makes this read as a landform rather than a bullseye.
    const cx = W * (0.30 + rand() * 0.30);
    const cy = H * (0.34 + rand() * 0.32);

    // Shared centre drift — one endpoint-zero sine per axis, integer harmonic, so the whole stack
    // sways as one body and the level ordering is untouched.
    const driftAmp = Math.min(W, H) * 0.045 * drift;
    const driftH = { x: 1 + Math.floor(rand() * 2), y: 1 + Math.floor(rand() * 2) };
    const driftPhaseSign = rand() < 0.5 ? -1 : 1;

    // Per-level shape: three angular harmonics with per-level phases (independent meander) and
    // integer temporal harmonics (loop-exact). Coefficients are normalised to sum to 1 so |s_L| <= 1
    // and the nesting bound above holds for ANY phase combination.
    const levels = [];
    for (let L = 0; L < steps; L++) {
      const raw = [0.55 + rand() * 0.30, 0.28 + rand() * 0.22, 0.14 + rand() * 0.16];
      const sum = raw[0] + raw[1] + raw[2];
      const harm = [];
      for (let j = 0; j < 3; j++) {
        harm.push({
          c: raw[j] / sum,                                  // normalised amplitude
          m: 2 + Math.floor(rand() * 4),                    // angular harmonic 2..5
          n: 1 + Math.floor(rand() * 2),                    // TEMPORAL harmonic 1..2 (integer => loop-exact)
          phase: rand() * TAU,
        });
      }
      levels.push({
        R: maxR * (1 - L / steps),
        harm,
        // Linear alpha ramp: level 0 (outermost) lightest, the innermost plateau at full inkAlpha.
        // Linear in alpha == linear in composited tone == equal steps.
        alpha: inkAlpha * ((L + 1) / steps),
      });
    }

    return { W, H, ground, steps, cx, cy, maxR, gap, wobble, driftAmp, driftH, driftPhaseSign, levels, ink: INK[ground] };
  }

  // Radius of level L at angle theta and loop position tN. Pure function of (L, theta, tN).
  function radiusAt(state, L, theta, tN) {
    const lv = state.levels[L];
    let s = 0;
    for (let j = 0; j < lv.harm.length; j++) {
      const h = lv.harm[j];
      s += h.c * Math.cos(h.m * theta + h.phase + TAU * h.n * tN);
    }
    return lv.R + state.wobble * s;
  }

  // Trace level L as a closed sub-path on ctx. Shared by the fill body and the even-odd hole.
  function traceRing(ctx, state, L, tN, ox, oy) {
    for (let i = 0; i < RING_SAMPLES; i++) {
      const theta = (i / RING_SAMPLES) * TAU;
      const r = radiusAt(state, L, theta, tN);
      const x = state.cx + ox + r * Math.cos(theta);
      const y = state.cy + oy + r * Math.sin(theta);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* drawTerraceBackground(ctx, state, t): pure canvas 2D API (fillRect / paths / evenodd fill /
   * globalAlpha) — no DOM, no offscreen canvas, no CSS, so it runs identically under node-canvas and
   * Chrome. Paints the ground, then one flat annulus per plateau from outermost inwards.
   */
  function drawTerraceBackground(ctx, state, t) {
    const loopSec = state.loopSec || (state.spec && state.spec.motion && state.spec.motion.speed.loopSec) || 8;
    const tN = ((t / loopSec) % 1 + 1) % 1;
    drawTerraceAt(ctx, state, tN);
  }

  // tN-addressed form — the composer calls this so loopSec stays owned by the merged motion rather
  // than being duplicated into terrace's state.
  function drawTerraceAt(ctx, state, tN) {
    const { W, H } = state;
    ctx.save();
    ctx.fillStyle = (state.ground === 'carbon') ? '#0a0a0f' : '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const ox = state.driftAmp * Math.sin(TAU * state.driftH.x * tN);
    const oy = state.driftAmp * state.driftPhaseSign * Math.sin(TAU * state.driftH.y * tN);

    ctx.fillStyle = state.ink;
    for (let L = 0; L < state.steps; L++) {
      ctx.globalAlpha = state.levels[L].alpha;
      ctx.beginPath();
      traceRing(ctx, state, L, tN, ox, oy);
      // Every level except the innermost is an ANNULUS: the next ring becomes an even-odd hole, so
      // this plateau's alpha is laid down exactly once and the tonal steps stay equal.
      if (L + 1 < state.steps) traceRing(ctx, state, L + 1, tN, ox, oy);
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return { buildTerrace, drawTerraceBackground, drawTerraceAt, DEFAULTS, MIN_STEPS, MAX_STEPS, INK };
});
