/* Ratio contract — single source of truth for the four Phase-4 aspect ratios (RATIO-01..05).
 * UMD: sets globalThis.INTERCEPT_RATIOS in the browser, module.exports in Node. Same wrapper
 * pattern as src/motion-presets.js. No DOM usage.
 *
 * These enum names ('1x1'|'4x5'|'9x16'|'16x9') are the LOCKED Phase 7 UI ratio-picker values
 * (.planning/phases/04-aspect-ratio-re-layout/04-CONTEXT.md) — do not rename. 1:1 remains the
 * default ratio everywhere (LinkedIn desktop pillarboxing, locked since the roadmap).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.INTERCEPT_RATIOS = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const RATIOS = {
    '1x1': { w: 1080, h: 1080 },
    '4x5': { w: 1080, h: 1350 },
    '9x16': { w: 1080, h: 1920 },
    '16x9': { w: 1920, h: 1080 },
  };
  const RATIO_KEYS = Object.keys(RATIOS);

  // baseDir when ratio is '1x1' (the default) or null/undefined (legacy callers) — else
  // `${baseDir}-${ratio}`, e.g. platesDirFor('templates/new-hire/plates', '9x16') ===
  // 'templates/new-hire/plates-9x16' (the per-ratio recaptured plates dir, RATIO-05).
  function platesDirFor(baseDir, ratio) {
    if (ratio == null || ratio === '1x1') return baseDir;
    return `${baseDir}-${ratio}`;
  }

  return { RATIOS, RATIO_KEYS, platesDirFor };
});
