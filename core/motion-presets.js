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

    // fritzfield (2026-08-04) — the Weekly Pulse deck's densely-packed Fritzoid library, animated.
    // Values are lifted from the deck's QUIET sets (make_fritzoid_soft{,_halo}.py), which are the ones
    // authored to sit behind copy: 10px cell, 1-4px gap, opacity 0.07-0.22. The two grounds are NOT
    // symmetric — Carbon takes roughly 1.5x the opacity of Halo, and Halo runs a tighter gap, exactly
    // as the shipped sets do. `pattern` / `palette` / `colorMode` / `animate` are USER choices, so they
    // are deliberately absent here: a preset sets intensity only, and must never silently re-pick the
    // design. Defaults for those live in fritzfield.js DEFAULTS (ov-nest / coolsweep-only, Jon's deck
    // pick). Anything a preset omits falls through to those.
    fritzfield: {
      halo: {
        subtle: { cell: 10, gap: 1, layers: 3, opacity: 0.07, ovAlpha: 0.78, ovScale: 0.85, amp: 0.40, waves: 1, bands: 14 },
        standard: { cell: 10, gap: 1, layers: 4, opacity: 0.11, ovAlpha: 0.80, ovScale: 0.78, amp: 0.55, waves: 1, bands: 16 },
        bold: { cell: 10, gap: 2, layers: 4, opacity: 0.16, ovAlpha: 0.85, ovScale: 0.72, amp: 0.65, waves: 2, bands: 18 },
      },
      carbon: {
        subtle: { cell: 10, gap: 2, layers: 3, opacity: 0.11, ovAlpha: 0.80, ovScale: 0.85, amp: 0.40, waves: 1, bands: 14 },
        standard: { cell: 10, gap: 2, layers: 4, opacity: 0.17, ovAlpha: 0.85, ovScale: 0.78, amp: 0.55, waves: 1, bands: 16 },
        bold: { cell: 10, gap: 3, layers: 4, opacity: 0.24, ovAlpha: 0.88, ovScale: 0.72, amp: 0.65, waves: 2, bands: 18 },
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
