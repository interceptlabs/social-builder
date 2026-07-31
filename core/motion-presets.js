/* Motion presets — ground-aware STYLE x PRESET x GROUND table for the named motion styles
 * (MOTN-01). UMD: sets globalThis.MOTION_PRESETS in the browser, module.exports in Node. No DOM
 * usage — same wrapper pattern as engine.js.
 *
 * PRESETS[style][ground][preset] -> a flat "override object" shaped like a subset of the
 * composition spec's `motion` block (e.g. { cluster: {...}, movement: {...} } for keyline).
 * Consumed by composer.js's mergeMotion as the middle layer of the merge order:
 *   DEFAULT_MOTION < resolvePreset(style, preset, ground) < spec.motion's explicit fields.
 *
 * Preset names 'subtle' | 'standard' | 'bold' are a STABLE Phase-7 UI contract — do not rename.
 *
 * keyline: carbon (dark) ground is deliberately subtler than halo at every preset tier — this is
 * the structural fix for Jon's 07-22 visual-gate note ("carousel ribbon too strong on dark").
 * halo-standard equals today's proven DEFAULT_MOTION values (composer.js) so the default look is
 * unchanged by naming it.
 *
 * fritzoid: preset shape/names are the stable contract 03-02's Fritzoid renderer consumes; exact
 * values are 03-02's to tune. Defined here now so the spec dispatch point (motion.style) has a
 * real preset table on both sides from day one.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MOTION_PRESETS = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const PRESETS = {
    keyline: {
      halo: {
        subtle: { cluster: { op: 0.07, wt: 0.95 }, movement: { intensity: 0.6 } },
        standard: { cluster: { op: 0.11, wt: 1.10 }, movement: { intensity: 0.85 } },
        bold: { cluster: { op: 0.15, wt: 1.25 }, movement: { intensity: 1.1 } },
      },
      carbon: {
        subtle: { cluster: { op: 0.035, wt: 0.85 }, movement: { intensity: 0.6 } },
        standard: { cluster: { op: 0.045, wt: 0.95 }, movement: { intensity: 0.85 } },
        bold: { cluster: { op: 0.07, wt: 1.10 }, movement: { intensity: 1.1 } },
      },
    },
    fritzoid: {
      halo: {
        subtle: { tileBase: 84, wavesPerLoop: 1, inkAlpha: 0.05 },
        standard: { tileBase: 84, wavesPerLoop: 2, inkAlpha: 0.08 },
        bold: { tileBase: 84, wavesPerLoop: 3, inkAlpha: 0.12 },
      },
      carbon: {
        subtle: { tileBase: 84, wavesPerLoop: 1, inkAlpha: 0.06 },
        standard: { tileBase: 84, wavesPerLoop: 2, inkAlpha: 0.10 },
        bold: { tileBase: 84, wavesPerLoop: 3, inkAlpha: 0.14 },
      },
    },

    // fan (2026-07-30) — the generator's "Fan (shared origin)" overlap mode. Tiers move the LAYER
    // COUNT and ink weight together: more layers is a fuller fan, not just a darker one. `cell` shrinks
    // as layers grow so a bold fan stays a rhythm rather than a wall. Carbon runs a touch lighter than
    // halo at every tier — the channel hues sit hotter on a dark ground (Jon's 07-22 dark-ground note).
    fan: {
      halo: {
        subtle: { cell: 230, layers: 3, alpha: 0.13, ovScale: 0.88, ovAlpha: 0.70, breathe: 0.16, waves: 1 },
        standard: { cell: 190, layers: 5, alpha: 0.20, ovScale: 0.86, ovAlpha: 0.72, breathe: 0.22, waves: 1 },
        bold: { cell: 155, layers: 6, alpha: 0.27, ovScale: 0.84, ovAlpha: 0.74, breathe: 0.30, waves: 2 },
      },
      carbon: {
        subtle: { cell: 230, layers: 3, alpha: 0.11, ovScale: 0.88, ovAlpha: 0.70, breathe: 0.16, waves: 1 },
        standard: { cell: 190, layers: 5, alpha: 0.17, ovScale: 0.86, ovAlpha: 0.72, breathe: 0.22, waves: 1 },
        bold: { cell: 155, layers: 6, alpha: 0.23, ovScale: 0.84, ovAlpha: 0.74, breathe: 0.30, waves: 2 },
      },
    },

    // shingle (2026-07-30) — the generator's "Shingle (roof tile)" overlap mode over herringbone lean
    // parity. Tiers move course DEPTH (layers), overlap (ovOffset) and ink weight together, so bold is
    // a deeper, tighter-lapped course. Drift speed is fixed by the loop-seam maths (exactly two cells
    // per loop, see shingle.js) and is deliberately NOT a preset knob.
    shingle: {
      halo: {
        subtle: { cell: 180, layers: 3, alpha: 0.12, ovOffset: 0.50, ovScale: 0.90, ovAlpha: 0.66 },
        standard: { cell: 150, layers: 4, alpha: 0.18, ovOffset: 0.55, ovScale: 0.88, ovAlpha: 0.68 },
        bold: { cell: 125, layers: 5, alpha: 0.25, ovOffset: 0.62, ovScale: 0.86, ovAlpha: 0.70 },
      },
      carbon: {
        subtle: { cell: 180, layers: 3, alpha: 0.10, ovOffset: 0.50, ovScale: 0.90, ovAlpha: 0.66 },
        standard: { cell: 150, layers: 4, alpha: 0.15, ovOffset: 0.55, ovScale: 0.88, ovAlpha: 0.68 },
        bold: { cell: 125, layers: 5, alpha: 0.21, ovOffset: 0.62, ovScale: 0.86, ovAlpha: 0.70 },
      },
    },
  };

  // Returns {} for unknown style/ground/preset combos rather than throwing — callers merge the
  // result as an additive override layer, so an empty object is a safe no-op.
  function resolvePreset(style, preset, ground) {
    const byStyle = PRESETS[style];
    if (!byStyle) return {};
    const byGround = byStyle[ground];
    if (!byGround) return {};
    return byGround[preset] || {};
  }

  return { PRESETS, resolvePreset };
});
