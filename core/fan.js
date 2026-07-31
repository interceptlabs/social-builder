/* Fan — the Fritz pattern generator's `ov-fan` overlap mode as an animated, loop-safe background.
 * UMD: sets globalThis.INTERCEPT_FAN in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG — load it first.
 *
 * SOURCE: intercept-brand-kit/.fritz/generators/fritz-pattern.html, mode "Fan (shared origin)".
 * Ported behaviour, verbatim in structure:
 *     case 'ov-fan':
 *       lDir   = li % 2 === 0 ? 'right' : 'left';   // alternate lean per layer
 *       lVerts = triVerts(cell, lDir);
 *       lScale *= Math.pow(ovScale, li * 0.5);      // gentle scale decay outward
 *   with the generator's shared per-layer alpha decay lAlpha = alpha * ovAlpha^li.
 * Every layer of a cell shares ONE origin, so each cell resolves into a butterfly/fan burst of
 * nested, alternately-leaning triangles rather than a tiled field of single triangles. That is what
 * separates it from fritzoid, which is the generator's `truchet` mode (one randomly-leaning triangle
 * per cell) — fan is the same canonical triangle used as a radial motif instead of a tile.
 *
 * TRIANGLE RULE: triVerts is the generator's own, copied exactly — apex-up, right angle on the base,
 * and lean is a horizontal MIRROR, never a rotation. Nothing here rotates a triangle.
 *
 * COLOUR: the generator's default `fritz` palette — the three brand channels
 * (flarepop / wiretree / coolsweep) — assigned per LAYER, which is the generator's 'per-layer' colour
 * mode. Channel hues are legal here: the ink-first, no-channel-hue rule is fritzoid-specific (see
 * scripts/verify-brand-qa.cjs, which gates those two checks on `combo.style === 'fritzoid'`), and the
 * keyline background already paints the same channels at low opacity.
 *
 * MOTION — the fan breathes open and closed, with the phase travelling outward from a seeded focus so
 * a slow pulse ripples across the field. Both the spread and the per-layer alpha ride
 * cos(2*PI*n*tN + phi(cell)) with INTEGER n, so tN=1 reproduces tN=0 exactly and the loop seam is
 * byte-exact. (A background only has to satisfy frame0 === frameN — unlike a LAYER transform it does
 * not need to be identity at tN=0 — so a per-cell phase offset is free here. Same contract fritzoid's
 * tile field uses.) The sine also means it never lands hard at either end of its travel.
 *
 * COMPOSED, NOT TILED — this is the one place it deliberately departs from the generator. The
 * generator makes full-bleed PATTERN for brand surfaces; edge-to-edge high-contrast triangles behind
 * a headline would wreck legibility. So the field is massed around a seeded focus and falls off
 * smoothly to nothing across the rest of the frame, leaving real negative space for the copy — the
 * same compositional logic keyline already uses (one ribbon cluster, not a repeating motif). The
 * falloff is a function of SCREEN POSITION and of nothing time-varying, so it cannot affect the seam.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_FAN = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';

  const TAU = Math.PI * 2;

  // The generator's `fritz` palette (PALS.fritz) — the three brand channels, verbatim.
  const CHANNELS = ['#ff00e5', '#00d862', '#1a7aff'];

  const DEFAULTS = {
    cell: 190,        // grid module in px at 1080 — the generator's "Cell size"
    layers: 5,        // triangles per fan (generator's "Layers")
    ovScale: 0.86,    // per-layer scale decay base (generator default 0.85)
    ovAlpha: 0.72,    // per-layer alpha decay base (generator default 0.70)
    alpha: 0.20,      // base-layer alpha
    breathe: 0.22,    // how far the fan opens/closes across the loop
    waves: 1,         // pulses per loop (INTEGER — this is what keeps the seam exact)
    reach: 0.55,      // mass radius as a fraction of the frame diagonal (composition, not wallpaper)
    decay: 0.9,       // exponent on the per-layer scale decay — higher nests the fan more visibly
  };

  // Canonical right-angle triangle — PORTED VERBATIM from fritz-pattern.html triVerts.
  // Apex-up; lean L/R is a horizontal MIRROR only, never a rotation.
  function triVerts(cellSize, dir) {
    const half = cellSize * 0.5;
    if (dir === 'right') return [[-half, -half], [-half, half], [half, half]];
    return [[half, -half], [half, half], [-half, half]];
  }

  // The generator's hash-noise, verbatim (fritz-pattern.html `ns`).
  function ns(x, y, s) {
    const a = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453;
    return a - Math.floor(a);
  }

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function int(v, lo, hi, d) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }

  function buildFan(spec, m) {
    const W = spec.size.w, H = spec.size.h;
    const ground = (spec.bg === 'carbon') ? 'carbon' : 'halo';
    const seed = (m.seed >>> 0) ^ 0x0fa4;
    const rand = E.rng(seed >>> 0);

    // Scale the module with the frame so a 9:16 story gets the same visual rhythm as a square.
    const cell = num(m.cell, DEFAULTS.cell) * (Math.min(W, H) / 1080);
    const cols = Math.ceil(W / cell) + 2;   // +2 so the field bleeds past both edges
    const rows = Math.ceil(H / cell) + 2;

    // Seeded focus for the outward-travelling pulse.
    const fx = W * (0.2 + rand() * 0.6);
    const fy = H * (0.2 + rand() * 0.6);
    const maxD = Math.sqrt(W * W + H * H);

    return {
      W, H, ground, seed, cell, cols, rows, fx, fy, maxD,
      layers: int(m.layers, 1, 8, DEFAULTS.layers),
      ovScale: num(m.ovScale, DEFAULTS.ovScale),
      ovAlpha: num(m.ovAlpha, DEFAULTS.ovAlpha),
      alpha: num(m.alpha, DEFAULTS.alpha),
      breathe: num(m.breathe, DEFAULTS.breathe),
      waves: int(m.waves, 1, 4, DEFAULTS.waves),
      reach: num(m.reach, DEFAULTS.reach),
      decay: num(m.decay, DEFAULTS.decay),
    };
  }

  // drawFanAt(ctx, state, tN): pure canvas 2D (paths / alpha / transform) — no DOM, no offscreen
  // canvas, no CSS, so node-canvas and Chrome render it identically.
  function drawFanAt(ctx, state, tN) {
    const { W, H, cell, cols, rows, layers } = state;
    ctx.save();
    ctx.fillStyle = (state.ground === 'carbon') ? '#0a0a0f' : '#ffffff';
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = (c - 0.5) * cell + cell * 0.5;
        const cy = (r - 0.5) * cell + cell * 0.5;

        // Outward-travelling phase: cells further from the focus open later.
        const d = Math.sqrt((cx - state.fx) * (cx - state.fx) + (cy - state.fy) * (cy - state.fy));

        // MASS the field around the focus and fade it to nothing — smoothstep on distance/reach.
        // Purely a function of screen position, so it cannot disturb the loop seam.
        const u = d / (state.maxD * state.reach);
        if (u >= 1) continue;                       // outside the mass: leave the ground clean
        const k = 1 - u * u * (3 - 2 * u);          // smoothstep, 1 at the focus -> 0 at the edge
        const phi = (d / state.maxD) * TAU * 1.6 + ns(c, r, state.seed + 100) * 0.6;
        // INTEGER harmonic => identical at tN=0 and tN=1.
        const open = 1 + state.breathe * Math.cos(TAU * state.waves * tN + phi);

        for (let li = 0; li < layers; li++) {
          // --- the generator's ov-fan case, ported ---
          const dir = li % 2 === 0 ? 'right' : 'left';
          const verts = triVerts(cell, dir);
          const scale = Math.pow(state.ovScale, li * state.decay) * open;
          const alpha = state.alpha * Math.pow(state.ovAlpha, li) * k;
          // ------------------------------------------
          if (alpha <= 0.002 || scale <= 0.01) continue;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(scale, scale);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = CHANNELS[li % CHANNELS.length]; // generator's 'per-layer' colour mode
          ctx.beginPath();
          ctx.moveTo(verts[0][0], verts[0][1]);
          ctx.lineTo(verts[1][0], verts[1][1]);
          ctx.lineTo(verts[2][0], verts[2][1]);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawFanBackground(ctx, state, t) {
    drawFanAt(ctx, state, (((t / (state.loopSec || 8)) % 1) + 1) % 1);
  }

  return { buildFan, drawFanAt, drawFanBackground, triVerts, ns, CHANNELS, DEFAULTS };
});
