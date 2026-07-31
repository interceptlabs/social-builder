/* Shingle — the Fritz pattern generator's `ov-shingle` overlap mode as an animated, loop-safe
 * background, laid over the generator's `herringbone` lean parity.
 * UMD: sets globalThis.INTERCEPT_SHINGLE in the browser, module.exports in Node.
 * Depends on engine.js (INTERCEPT_TEAMS) for the seeded RNG — load it first.
 *
 * SOURCE: intercept-brand-kit/.fritz/generators/fritz-pattern.html.
 * Ported behaviour, verbatim in structure:
 *     case 'ov-shingle':                                  // "Shingle (roof tile)"
 *       lCy    += li * off * 0.5;                          // each layer steps DOWN
 *       lCx    += (li % 2 === 1 ? 1 : -1) * off * 0.15;    // and jogs alternately left/right
 *       lScale *= Math.pow(ovScale, li * 0.6);
 *   and the lean parity from the grid modes:
 *     case 'herringbone': return rel(row % 2 === 0 ? (col % 2 === 0) : (col % 2 !== 0));
 *   with the generator's shared per-layer alpha decay lAlpha = alpha * ovAlpha^li.
 * Each cell becomes a short course of overlapping tiles stepping down the frame; the herringbone
 * parity flips the lean cell to cell so the courses interlock. Where fan is the same triangle used
 * radially, shingle is it used as laid, directional masonry — and neither is fritzoid's truchet
 * (one randomly-leaning triangle per cell, no overlap).
 *
 * TRIANGLE RULE: triVerts is the generator's own, copied exactly — apex-up, right angle on the base,
 * lean is a horizontal MIRROR, never a rotation.
 *
 * COLOUR: the generator's default `fritz` palette (the three brand channels), keyed to the tile so
 * the courses band rather than strobe. Channel hues are legal here — the ink-first/no-channel-hue
 * rule is fritzoid-specific (scripts/verify-brand-qa.cjs gates both checks on
 * `combo.style === 'fritzoid'`), and keyline already paints the same channels at low opacity.
 *
 * MOTION — the courses DRIFT down-frame continuously, like a slow conveyor of tiles, rather than
 * rocking back and forth. That is only loop-safe because the drift is exactly TWO cells per loop and
 * the pattern is invariant under a 2-cell shift:
 *   - lean depends on col%2 and row%2, and (row+2)%2 === row%2;
 *   - colour is keyed on (col%2, row%2) for the same reason.
 * So at tN=1 every tile has moved into the position of a tile that is its exact twin, and the frame
 * is identical to tN=0. Shifting by ONE cell would flip both parities and break the seam; a hash-keyed
 * colour or lean would break it too, which is why neither is used. Rows are drawn two beyond each edge
 * so the incoming course is never clipped into view.
 */
(function (root, factory) {
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.INTERCEPT_TEAMS;
  const api = factory(E);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_SHINGLE = api;
})(typeof self !== 'undefined' ? self : globalThis, function (E) {
  'use strict';

  // The generator's `fritz` palette (PALS.fritz) — the three brand channels, verbatim.
  const CHANNELS = ['#ff00e5', '#00d862', '#1a7aff'];

  // Drift distance per loop, in cells. MUST be even — the pattern's parity period is 2 in both axes,
  // so only an even shift maps every tile onto an identical twin and keeps the seam exact.
  const DRIFT_CELLS = 2;

  const DEFAULTS = {
    cell: 150,       // grid module in px at 1080
    layers: 4,       // tiles per course
    ovOffset: 0.55,  // generator's "Offset amount", as a fraction of the cell
    ovScale: 0.88,
    ovAlpha: 0.68,
    alpha: 0.18,
    lean: 'right',   // baseDir; herringbone parity flips it per tile
    reach: 0.62,     // how far across the frame the courses carry before fading out
  };

  // PORTED VERBATIM from fritz-pattern.html triVerts.
  function triVerts(cellSize, dir) {
    const half = cellSize * 0.5;
    if (dir === 'right') return [[-half, -half], [-half, half], [half, half]];
    return [[half, -half], [half, half], [-half, half]];
  }

  // The generator's herringbone lean parity, expressed relative to a base direction.
  function herringboneDir(baseDir, col, row) {
    const flip = (d) => (d === 'right' ? 'left' : 'right');
    const cond = (row % 2 === 0) ? (col % 2 === 0) : (col % 2 !== 0);
    return cond ? baseDir : flip(baseDir);
  }

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function int(v, lo, hi, d) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; }
  // Non-negative modulo — plain % keeps the sign, which would mis-key parity for the negative
  // row/column indices the bleed uses.
  function mod(n, k) { return ((n % k) + k) % k; }

  function buildShingle(spec, m) {
    const W = spec.size.w, H = spec.size.h;
    const ground = (spec.bg === 'carbon') ? 'carbon' : 'halo';
    const cell = num(m.cell, DEFAULTS.cell) * (Math.min(W, H) / 1080);
    return {
      W, H, ground, cell,
      cols: Math.ceil(W / cell) + 3,
      rows: Math.ceil(H / cell) + 4,     // extra rows so the drifting course never pops in
      layers: int(m.layers, 1, 8, DEFAULTS.layers),
      ovOffset: num(m.ovOffset, DEFAULTS.ovOffset),
      ovScale: num(m.ovScale, DEFAULTS.ovScale),
      ovAlpha: num(m.ovAlpha, DEFAULTS.ovAlpha),
      alpha: num(m.alpha, DEFAULTS.alpha),
      lean: (m.lean === 'left' || m.lean === 'right') ? m.lean : DEFAULTS.lean,
      reach: num(m.reach, DEFAULTS.reach),
    };
  }

  // drawShingleAt(ctx, state, tN): pure canvas 2D — no DOM, no offscreen canvas, no CSS.
  function drawShingleAt(ctx, state, tN) {
    const { W, H, cell, cols, rows, layers } = state;
    const off = cell * state.ovOffset;

    ctx.save();
    ctx.fillStyle = (state.ground === 'carbon') ? '#0a0a0f' : '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // Continuous downward drift, exactly DRIFT_CELLS cells across the loop.
    const drift = DRIFT_CELLS * cell * tN;

    for (let r = -2; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        const dir = herringboneDir(state.lean, mod(c, 2), mod(r, 2));
        // Colour keyed on PARITY only, so it survives the 2-cell shift (see the header).
        const colour = CHANNELS[(mod(c, 2) + 2 * mod(r, 2)) % CHANNELS.length];
        const baseX = c * cell + cell * 0.5;
        const baseY = r * cell + cell * 0.5 + drift;

        for (let li = 0; li < layers; li++) {
          // --- the generator's ov-shingle case, ported ---
          const lCx = baseX + (li % 2 === 1 ? 1 : -1) * off * 0.15;
          const lCy = baseY + li * off * 0.5;
          const scale = Math.pow(state.ovScale, li * 0.6);
          const alpha = state.alpha * Math.pow(state.ovAlpha, li);
          // ----------------------------------------------
          // DIRECTIONAL falloff: the courses are laid heaviest along one diagonal and fade to nothing
          // across the rest, so the frame keeps real negative space for copy instead of becoming
          // wallpaper. A function of SCREEN position only — a drifted tile inherits the falloff of the
          // position it moves into, which is exactly why the 2-cell-shift seam still holds.
          const u = ((lCx / W) * 0.68 + (lCy / H) * 0.32) / state.reach;
          const k = u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);   // smoothstep
          if (k <= 0) continue;
          const a2 = alpha * k;
          if (a2 <= 0.002) continue;
          if (lCy < -cell * 2 || lCy > H + cell * 2) continue; // cheap cull, no visual effect
          const verts = triVerts(cell, dir);
          ctx.save();
          ctx.translate(lCx, lCy);
          ctx.scale(scale, scale);
          ctx.globalAlpha = a2;
          ctx.fillStyle = colour;
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

  function drawShingleBackground(ctx, state, t) {
    drawShingleAt(ctx, state, (((t / (state.loopSec || 8)) % 1) + 1) % 1);
  }

  return { buildShingle, drawShingleAt, drawShingleBackground, triVerts, herringboneDir, CHANNELS, DRIFT_CELLS, DEFAULTS };
});
