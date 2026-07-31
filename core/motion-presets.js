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

    // terrace (2026-07-30) — quantized contour plateaus. `steps` IS the brand's hard-edged-steps count
    // and stays inside 3..9 at every tier; the preset tiers move the STEP COUNT and the ink weight
    // together, because more plateaus at the same alpha would read as a smooth grade (exactly what the
    // rule forbids). Carbon is held subtler than halo at every tier — the same structural correction
    // keyline carries for Jon's 07-22 "ribbon too strong on dark" note: light ink on a dark ground
    // reads hotter than dark ink on a light one at equal alpha.
    terrace: {
      halo: {
        subtle: { steps: 4, inkAlpha: 0.055, spread: 0.52, relief: 0.8, drift: 0.7 },
        standard: { steps: 6, inkAlpha: 0.090, spread: 0.55, relief: 1.0, drift: 1.0 },
        bold: { steps: 8, inkAlpha: 0.130, spread: 0.60, relief: 1.15, drift: 1.2 },
      },
      // Carbon carries slightly MORE alpha than the arithmetic would suggest: an 8-bit step of the same
      // alpha lands a smaller absolute tone gap on the dark ground (measured 3/255 vs 4/255 at bold),
      // so matching the numbers exactly would make the plateaus genuinely harder to see rather than
      // just calmer. Still held under halo at every tier per Jon's dark-ground note.
      carbon: {
        subtle: { steps: 4, inkAlpha: 0.048, spread: 0.52, relief: 0.8, drift: 0.7 },
        standard: { steps: 6, inkAlpha: 0.078, spread: 0.55, relief: 1.0, drift: 1.0 },
        bold: { steps: 8, inkAlpha: 0.112, spread: 0.60, relief: 1.15, drift: 1.2 },
      },
    },

    // ashlar (2026-07-30) — grid-set plates in depth-banded parallax. Tiers move plate COUNT, ink
    // weight and parallax together so 'bold' is a denser, more active wall rather than just a darker
    // one. triShare stays a minority so the apex-up triangles read as accents inside a rectilinear
    // field. Carbon subtler than halo at every tier, same reason as terrace.
    ashlar: {
      halo: {
        subtle: { plates: 7, inkAlpha: 0.055, drift: 0.7, triShare: 0.25 },
        standard: { plates: 11, inkAlpha: 0.085, drift: 1.0, triShare: 0.30 },
        bold: { plates: 16, inkAlpha: 0.120, drift: 1.25, triShare: 0.35 },
      },
      carbon: {
        subtle: { plates: 7, inkAlpha: 0.040, drift: 0.7, triShare: 0.25 },
        standard: { plates: 11, inkAlpha: 0.060, drift: 1.0, triShare: 0.30 },
        bold: { plates: 16, inkAlpha: 0.090, drift: 1.25, triShare: 0.35 },
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
