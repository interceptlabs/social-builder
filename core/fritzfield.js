/* Fritz Field — the densely-packed Fritzoid pattern library, animated and loop-safe.
 * UMD: sets globalThis.INTERCEPT_FRITZFIELD in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) — load it first.
 *
 * WHAT THIS IS. A faithful canvas port of the pattern engine used for the Weekly Pulse deck
 * backgrounds (Creative-Projects/_intercept-inbox/pulse-keyline-backgrounds/make_fritzoid_fields.py),
 * which is itself a port of the browser tool at
 * intercept-brand-book/generators/fritz-pattern-public.html. Same ns() hash, same triVerts(), same
 * pattern / tile-facing / colour / overlay / blend modes and the same parameter names — so a design
 * found in the browser tool or in the deck library can be reproduced here by matching settings, and
 * vice versa. It replaces the two hand-rolled styles (fan / shingle), which were the same two overlay
 * modes at 125-190px cells — roughly 15x too coarse to read as a Fritzoid field at all.
 *
 * 17 patterns x 7 palettes x 7 colour modes x 4 animations, all reachable from the spec.
 *
 * GEOMETRY IS THE DECK'S, NOT INVENTED. cell = 10px with a 1-4px gap and opacity 0.07-0.22, which is
 * exactly the range of the deck's "quiet" sets — the ones authored to sit behind copy. Jon's picks for
 * the deck were herringbone and wave at full strength, and ov-nest / ov-stack / ov-shingle quiet, so
 * those are the preset defaults.
 *
 * THE CANON DIAGONAL IS 49.63°, NOT 45°. Measured off the canon mark
 * (intercept-brand-kit/.fritz/assets/logo/fritz-mark.svg): the long diagonals run at slope 1.17649 /
 * 1.17645 / 1.17641 — three subpaths agreeing to 0.002°, plus two more at 1.1739 / 1.17481. Anything
 * that has to run parallel to the mark uses CANON_SLOPE. The sweep bands below are cut on that angle
 * for exactly this reason; cutting them at 45° would read as a near-miss against the mark.
 *
 * BLEND: ground-dependent, and the two grounds want OPPOSITE things — a lesson recorded the hard way
 * in the deck library's README. Screen on Carbon makes overlaps glow; screen on Halo is a no-op and
 * every mark vanishes. Layer 0 is always source-over (as in the python); layers 1+ take `blend`,
 * defaulting to screen on Carbon and source-over on Halo (which is what the shipped quiet-Halo set
 * used). Override per spec if a design needs multiply.
 *
 * PERFORMANCE — why the geometry is precompiled. A 10px cell over 1080px is ~90x90 cells, so 4 layers
 * is ~32k triangles. Re-pathing that every frame would not hold 30fps in the preview. Instead every
 * triangle is bucketed ONCE at build time into (layer x band x colour) and compiled to a Path2D, so a
 * frame costs at most layers*bands*colours fills — under 200 — instead of 32,000. Path2D is used when
 * available and a plain coordinate replay is kept as the fallback, so this still runs under node-canvas
 * whatever its Path2D support.
 *
 * ANIMATION — the lattice is STATIC and the light moves over it. Bands cut on the canon diagonal each
 * carry their own alpha, and the animators phase those band alphas. Every animator is
 * 1 + amp*cos(2*PI*waves*tN + phase(band)) with an INTEGER `waves`, so tN=1 reproduces tN=0 exactly and
 * the loop seam is byte-exact by construction. Animating alpha rather than geometry is also what keeps
 * the precompiled paths valid, and on a dense field it reads far better than moving the marks: the
 * lattice stays crisp and legible while brightness rakes across it.
 *   still  — no modulation (the deck stills)
 *   pulse  — every band together, one breath per loop
 *   sweep  — a bright band travels along the canon diagonal
 *   ripple — phased outward from the centre band
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_FRITZFIELD = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';

  const TAU = Math.PI * 2;

  // Measured off the canon mark — see the header. Stripe/sweep geometry runs parallel to this.
  const CANON_SLOPE = 1.1765;

  const FLAREPOP = '#ff00e5', WIRETREE = '#00d862', COOLSWEEP = '#1a7aff';
  const HALO = '#ffffff', CARBON = '#0a0a0f';
  // graphite: a GREY carbon. Dark-ground ink rules apply unchanged; only the fill differs.
  const GRAPHITE = '#26262d';

  // Verbatim from the generator's PALS.
  const PALETTES = {
    'fritz': [FLAREPOP, WIRETREE, COOLSWEEP],
    'flarepop-only': [FLAREPOP],
    'wiretree-only': [WIRETREE],
    'coolsweep-only': [COOLSWEEP],
    'hotcatch': [FLAREPOP, COOLSWEEP],
    'suedejacket': [FLAREPOP, WIRETREE],
    'deepfield': [COOLSWEEP, WIRETREE],
  };
  const PALETTE_KEYS = Object.keys(PALETTES);

  // The generator's pattern modes: 8 grid + 9 overlay.
  const GRID_PATTERNS = ['truchet', 'pinwheel', 'diamond', 'herringbone', 'quilt', 'scatter', 'radial', 'wave'];
  const OVERLAY_PATTERNS = ['ov-stack', 'ov-fan', 'ov-nest', 'ov-mirror', 'ov-cross', 'ov-shingle', 'ov-weave', 'ov-cascade', 'ov-kaleidoscope'];
  const PATTERNS = GRID_PATTERNS.concat(OVERLAY_PATTERNS);

  const COLOR_MODES = ['random', 'per-layer', 'row', 'col', 'diagonal', 'radial', 'checker'];
  const ANIMATIONS = ['still', 'pulse', 'sweep', 'ripple'];

  const DEFAULTS = {
    pattern: 'ov-nest',
    palette: 'coolsweep-only',
    colorMode: 'diagonal',
    cell: 10,          // Jon: "the fritzoids should be small at 10 pixels"
    gap: 2,
    layers: 4,
    opacity: 0.18,
    ovAlpha: 0.85,
    ovScale: 0.72,
    ovOffset: 0.5,
    scale: 1.0,        // the python keeps this <= 1 so same-layer cells never overlap
    facing: 'right',
    tileFacing: 'fixed',
    blend: null,       // null => ground default (screen on carbon, source-over on halo)
    animate: 'sweep',
    bands: 16,
    amp: 0.55,
    waves: 1,          // INTEGER — this is what makes the seam exact
  };

  // ---- verbatim ports ----------------------------------------------------------------------------

  function ns(x, y, s) {
    const a = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453;
    return a - Math.floor(a);
  }

  // Canon right triangle: right angle at the base, leaning left or right only — never equilateral,
  // never upright. Lean is a horizontal MIRROR, never a rotation.
  function triVerts(cell, d) {
    const half = cell * 0.5;
    if (d === 'right') return [[-half, -half], [-half, half], [half, half]];
    return [[half, -half], [half, half], [-half, half]];
  }

  function patternDir(mode, c, r, cx, cy, seed, W, H) {
    if (mode === 'truchet') return ns(c, r, seed + 100) > 0.5 ? 'right' : 'left';
    if (mode === 'pinwheel') return (c + r) % 2 === 0 ? 'right' : 'left';
    if (mode === 'diamond') return (c % 2 === r % 2) ? 'right' : 'left';
    if (mode === 'herringbone') return (r % 2 === 0) ? (c % 2 === 0 ? 'right' : 'left') : (c % 2 === 0 ? 'left' : 'right');
    if (mode === 'quilt') return (Math.floor(c / 2) + Math.floor(r / 2)) % 2 === 0 ? 'right' : 'left';
    if (mode === 'scatter') return ns(c, r, seed + 150) > 0.5 ? 'right' : 'left';
    if (mode === 'radial') return Math.atan2(cy - H / 2, cx - W / 2) > 0 ? 'right' : 'left';
    if (mode === 'wave') return Math.sin(c * 0.6 + r * 0.4) > 0 ? 'right' : 'left';
    return null; // overlay modes fall through to the tile-facing logic
  }

  function tileDir(base, c, r, tmode, seed) {
    const flip = (d) => (d === 'right' ? 'left' : 'right');
    if (tmode === 'alternate-col') return c % 2 === 0 ? base : flip(base);
    if (tmode === 'alternate-row') return r % 2 === 0 ? base : flip(base);
    if (tmode === 'alternate-both') return (c + r) % 2 === 0 ? base : flip(base);
    if (tmode === 'random') return ns(c, r, seed + 300) > 0.5 ? 'right' : 'left';
    return base;
  }

  function colorIdx(cmode, c, r, cols, rows, li, n, seed) {
    if (n <= 1) return 0;
    if (cmode === 'random') return Math.floor(ns(c, r, seed) * n) % n;
    if (cmode === 'per-layer') return li % n;
    if (cmode === 'row') return r % n;
    if (cmode === 'col') return c % n;
    if (cmode === 'diagonal') return (c + r) % n;
    if (cmode === 'radial') return Math.floor(Math.hypot(c - cols / 2, r - rows / 2)) % n;
    if (cmode === 'checker') return (c + r) % 2 === 0 ? 0 : 1;
    return 0;
  }

  // Overlay layer transform for li > 0 — ported case-for-case.
  function layerTransform(mode, li, cell, ovOff, ovScale, d) {
    const off = cell * ovOff;
    const flip = d === 'right' ? 'left' : 'right';
    if (mode === 'ov-stack') return [li * off * 0.35, li * off * 0.2, Math.pow(ovScale, li), d];
    if (mode === 'ov-fan') return [0, 0, Math.pow(ovScale, li * 0.5), (li % 2 === 0 ? 'right' : 'left')];
    if (mode === 'ov-nest') return [0, 0, Math.pow(ovScale, li), d];
    if (mode === 'ov-mirror') return [0, 0, 1, flip];
    if (mode === 'ov-cross') return [0, 0, Math.pow(ovScale, li * 0.3), (li % 2 === 0 ? d : flip)];
    if (mode === 'ov-shingle') return [(li % 2 ? 1 : -1) * off * 0.15, li * off * 0.5, Math.pow(ovScale, li * 0.6), d];
    if (mode === 'ov-weave') return [(li % 2 === 0 ? 1 : -1) * off * 0.4, 0, Math.pow(ovScale, li * 0.4), (li % 2 === 0 ? d : flip)];
    if (mode === 'ov-cascade') return [li * off * 0.25, li * off * 0.4, Math.pow(ovScale, li * 0.5), d];
    if (mode === 'ov-kaleidoscope') return [0, 0, Math.pow(ovScale, Math.floor(li / 2) * 0.5), (li % 2 === 0 ? 'right' : 'left')];
    return [li * off * 0.2, li * off * 0.1, Math.pow(ovScale, li), d];
  }

  // ---- build ------------------------------------------------------------------------------------

  function pick(v, list, dflt) { return list.indexOf(v) !== -1 ? v : dflt; }
  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function int(v, lo, hi, d) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }

  function buildFritzField(spec, m) {
    const W = spec.size.w, H = spec.size.h;
    const ground = (spec.bg === 'carbon' || spec.bg === 'graphite') ? 'carbon' : 'halo';
    const pattern = pick(m.pattern, PATTERNS, DEFAULTS.pattern);
    const isOverlay = pattern.indexOf('ov-') === 0;
    const palKey = pick(m.palette, PALETTE_KEYS, DEFAULTS.palette);
    const pal = PALETTES[palKey];
    const colorMode = pick(m.colorMode, COLOR_MODES, DEFAULTS.colorMode);
    const animate = pick(m.animate, ANIMATIONS, DEFAULTS.animate);
    const seed = num(m.seed, 1234) + 0.0;

    // Scale the module with the frame so a 9:16 story keeps the same visual density as a square.
    const s = Math.min(W, H) / 1080;
    const cell = Math.max(2, num(m.cell, DEFAULTS.cell) * s);
    const gap = Math.max(0, num(m.gap, DEFAULTS.gap) * s);
    // The python forces >= 2 layers for overlay modes — a one-layer overlay is just the base grid.
    const layers = isOverlay ? Math.max(2, int(m.layers, 1, 6, DEFAULTS.layers)) : int(m.layers, 1, 6, 1);
    const opacity = num(m.opacity, DEFAULTS.opacity);
    const ovAlpha = num(m.ovAlpha, DEFAULTS.ovAlpha);
    const ovScale = num(m.ovScale, DEFAULTS.ovScale);
    const ovOffset = num(m.ovOffset, DEFAULTS.ovOffset);
    const scale = Math.min(1, num(m.scale, DEFAULTS.scale));
    const facing = (m.facing === 'left') ? 'left' : 'right';
    const tileFacing = m.tileFacing || DEFAULTS.tileFacing;
    const nBands = int(m.bands, 1, 48, DEFAULTS.bands);

    const cols = Math.floor(W / (cell + gap)) + 2;
    const rows = Math.floor(H / (cell + gap)) + 2;
    const totalW = cols * (cell + gap), totalH = rows * (cell + gap);
    const offX = (W - totalW) / 2 + cell / 2, offY = (H - totalH) / 2 + cell / 2;

    // Band index from the projection onto the CANON diagonal's normal, so the stripes run parallel to
    // the mark's own diagonal rather than at an arbitrary 45.
    const nx = CANON_SLOPE, nyv = 1;
    const nlen = Math.hypot(nx, nyv);
    const pMin = 0, pMax = (nx * W + nyv * H) / nlen;
    function bandOf(x, y) {
      const p = (nx * x + nyv * y) / nlen;
      let b = Math.floor(((p - pMin) / (pMax - pMin)) * nBands);
      if (b < 0) b = 0; if (b >= nBands) b = nBands - 1;
      return b;
    }

    // buckets[li][band][colour] = array of flat triangle coords
    const buckets = [];
    for (let li = 0; li < layers; li++) {
      const byBand = [];
      for (let b = 0; b < nBands; b++) {
        const byColor = [];
        for (let k = 0; k < pal.length; k++) byColor.push([]);
        byBand.push(byColor);
      }
      buckets.push(byBand);
    }

    for (let li = 0; li < layers; li++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = offX + c * (cell + gap), cy = offY + r * (cell + gap);
          let d = patternDir(pattern, c, r, cx, cy, seed, W, H);
          if (d === null) d = tileDir(facing, c, r, tileFacing, seed);
          let lcx = cx, lcy = cy, sc = scale;
          if (li) {
            const t = layerTransform(pattern, li, cell, ovOffset, ovScale, d);
            lcx = cx + t[0]; lcy = cy + t[1]; sc = scale * t[2]; d = t[3];
          }
          const ci = colorIdx(colorMode, c, r, cols, rows, li, pal.length, seed);
          const v = triVerts(cell, d);
          const arr = buckets[li][bandOf(lcx, lcy)][ci];
          for (let k = 0; k < 3; k++) { arr.push(lcx + v[k][0] * sc, lcy + v[k][1] * sc); }
        }
      }
    }

    // Compile to Path2D where available (the browser, and node-canvas builds that support it); keep the
    // raw coords otherwise so this module never hard-depends on Path2D existing.
    const hasPath2D = (typeof Path2D === 'function');
    const paths = buckets.map(function (byBand) {
      return byBand.map(function (byColor) {
        return byColor.map(function (coords) {
          if (!coords.length) return null;
          if (!hasPath2D) return new Float32Array(coords);
          const p = new Path2D();
          for (let i = 0; i < coords.length; i += 6) {
            p.moveTo(coords[i], coords[i + 1]);
            p.lineTo(coords[i + 2], coords[i + 3]);
            p.lineTo(coords[i + 4], coords[i + 5]);
            p.closePath();
          }
          return p;
        });
      });
    });

    return {
      W, H, ground, bg: (spec.bg === 'graphite') ? GRAPHITE : (ground === 'carbon' ? CARBON : HALO),
      pattern, palette: palKey, pal, colorMode, animate,
      cell, gap, layers, opacity, ovAlpha, nBands, hasPath2D, paths,
      amp: num(m.amp, DEFAULTS.amp),
      waves: int(m.waves, 1, 6, DEFAULTS.waves),
      // Layer 0 is always source-over (as in the python). Layers 1+ take the blend; the two grounds
      // want opposite things, so the default is ground-derived rather than a single constant.
      blend: m.blend || (ground === 'carbon' ? 'screen' : 'source-over'),
    };
  }

  // Per-band alpha multiplier. Every form is cos(2*PI*waves*tN + phase) with INTEGER waves, so it is
  // identical at tN=0 and tN=1 — the loop seam holds by construction, for every animator.
  function bandGain(state, b, tN) {
    const a = state.amp;
    if (state.animate === 'still' || a === 0) return 1;
    const w = TAU * state.waves * tN;
    if (state.animate === 'pulse') return 1 + a * Math.cos(w);
    if (state.animate === 'sweep') return 1 + a * Math.cos(w - TAU * (b / state.nBands));
    // ripple: phased outward from the centre band
    const mid = (state.nBands - 1) / 2;
    const u = mid === 0 ? 0 : Math.abs(b - mid) / mid;
    return 1 + a * Math.cos(w - Math.PI * u * 2);
  }

  function drawFritzFieldAt(ctx, state, tN) {
    const { W, H, paths, pal } = state;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, W, H);

    for (let li = 0; li < state.layers; li++) {
      const layerAlpha = state.opacity * (li ? Math.pow(state.ovAlpha, li) : 1);
      if (layerAlpha <= 0.004) break;
      ctx.globalCompositeOperation = li === 0 ? 'source-over' : state.blend;
      for (let b = 0; b < state.nBands; b++) {
        const gain = bandGain(state, b, tN);
        const a = layerAlpha * gain;
        if (a <= 0.004) continue;
        ctx.globalAlpha = Math.min(1, a);
        for (let ci = 0; ci < pal.length; ci++) {
          const p = paths[li][b][ci];
          if (!p) continue;
          ctx.fillStyle = pal[ci];
          if (state.hasPath2D) { ctx.fill(p); continue; }
          ctx.beginPath();
          for (let i = 0; i < p.length; i += 6) {
            ctx.moveTo(p[i], p[i + 1]);
            ctx.lineTo(p[i + 2], p[i + 3]);
            ctx.lineTo(p[i + 4], p[i + 5]);
            ctx.closePath();
          }
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function drawFritzFieldBackground(ctx, state, t) {
    drawFritzFieldAt(ctx, state, (((t / (state.loopSec || 8)) % 1) + 1) % 1);
  }

  return {
    buildFritzField, drawFritzFieldAt, drawFritzFieldBackground,
    PATTERNS, GRID_PATTERNS, OVERLAY_PATTERNS, PALETTES, PALETTE_KEYS, COLOR_MODES, ANIMATIONS,
    DEFAULTS, CANON_SLOPE, triVerts, ns,
  };
});
