/* Hot-take / statement template — loop-first model (v2.1, triangle removed 07-28 per Jon: "don't use
 * the triangle floaty element in hot take"). A punchy one/two-line claim that is FULLY COMPOSED +
 * legible at frame 0 (the poster) and at EVERY frame. LEGIBILITY IS AN INVARIANT: the statement is
 * ALWAYS composed unclipped at full opacity — no letter is ever partially cut. There is NO foreground
 * accent element: the statement (+ lockup) sit on the composition and ALL visual interest comes from
 * the BACKGROUND (procedural keyline/fritzoid motion, or an optional looping background video). This
 * template writes NO composer.js code and emits NO triangleSweep / foreground-accent field. (v2's
 * apex-up triangle SWEEP accent — and, before it, v1's triangleWipe CLIP — are both retired: Jon
 * rejected the foreground triangle outright, 07-28.)
 *
 * Slot -> layer mapping (stable contract for Phase 5-style content wiring + the Phase 13 builder):
 *   statement -> layer statement (one/two-line punchy claim; a string, may contain \n for a 2nd line)
 *   lockup    -> layer lockup    (canonical 8-path centered mark; always present)
 *
 * Loop-first model (LOOP-04 lineage): every layer renders present + composed at frame 0. The
 * statement is a full-frame plate drawn ON TOP at full alpha with no clip, so it stays fully legible
 * on every frame. Content is STATIC: every layer explicitly authors a ZERO-amplitude `float` (rather
 * than omitting the field) so composer.js's frozen DEFAULT_FLOAT fallback — still relied on by the
 * frozen legacy fixtures/goldens (scripts/verify-legacy-regression.cjs) — is never reached here;
 * composer.js itself is untouched. No `in`/`rise`/`exit`/`exitDur`/`drift` fields are emitted. Because
 * the statement is static and drawn unclipped at full alpha, frame 0 (poster) ≡ frame N (seam) and the
 * statement is byte-stable at every frame while the background animates behind it.
 *
 * Brand rules (MEMORY): canonical 8-path lockup; Flarepop magenta reserved for the accented FINAL LINE
 * of the statement (colored text only — see templates/hot-take/plates.html); NO decorative rule lines;
 * no gratuitous numbering; NO decorative/foreground triangle element (Jon, 07-28).
 */

const { RATIOS, RATIO_KEYS } = require('../ratios.js');

const defaults = {
  // Punchy, confident, Intercept-flavoured placeholder hot-take. Two lines: setup + Flarepop punch.
  // \n splits the display into two lines; the FINAL line renders in the Flarepop accent (colored
  // text only) — see templates/hot-take/plates.html's injector accent contract.
  statement: 'Off-brand\nis expensive.',
  lockup: 'centered',
};

// Static content (Jon rejected the floaty-text feel, v1.1 gate): an explicit ZERO-amplitude float,
// not an omitted field, so composer.js's DEFAULT_FLOAT fallback (still needed byte-identical for the
// frozen legacy fixtures/goldens) is never reached — visual interest comes from the animated
// BACKGROUND, not per-layer float and not any foreground accent element.
const ZERO_FLOAT = { driftX: 0, driftY: 0, breathe: 0 };

const VALID_STYLES = ['keyline', 'fritzoid', 'fritzfield'];
const VALID_PRESETS = ['subtle', 'standard', 'bold'];
// 'graphite' (2026-08-04) is a GREY carbon: same ink treatment as carbon (light copy on a
// dark ground) — only the background fill differs — so every plates.html ground rule and every
// preset table entry for carbon applies to it unchanged.
const VALID_GROUNDS = ['halo', 'carbon', 'graphite'];

function expand(slots, opts) {
  opts = opts || {};
  // TRANSITION-TIMING (Phase 14): loopSec settable per-post (default 8 => byte-identical). Passthrough
  // opts arrive as strings; composition-spec.js validates motion.speed.loopSec > 0 (rejects bad values).
  const loopSec = opts.loopSec != null ? Number(opts.loopSec) : 8;
  const style = opts.style || 'keyline';
  const preset = opts.preset || 'standard';
  const ratio = opts.ratio || '1x1';
  // Statement on dark reads as the punchy default for a hot-take; both grounds are supported.
  const ground = opts.ground || (slots && slots.ground) || 'carbon';
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`hot-take template: unknown --style="${style}" (expected one of ${VALID_STYLES.join('|')})`);
  }
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(`hot-take template: unknown --preset="${preset}" (expected one of ${VALID_PRESETS.join('|')})`);
  }
  if (!RATIO_KEYS.includes(ratio)) {
    throw new Error(`hot-take template: unknown --ratio="${ratio}" (expected one of ${RATIO_KEYS.join('|')})`);
  }
  if (!VALID_GROUNDS.includes(ground)) {
    throw new Error(`hot-take template: unknown ground="${ground}" (expected one of ${VALID_GROUNDS.join('|')})`);
  }

  // keyline: keep emitting engine:'keyline' (unchanged legacy spec shape) — preset resolution fills
  // cluster/position/movement. fritzoid: no engine field, no keyline-specific hand-tuning.
  const motion = style === 'keyline'
    ? { engine: 'keyline', style, preset, speed: { loopSec } }
    : { style, preset, speed: { loopSec } };

  const spec = {
    size: { w: RATIOS[ratio].w, h: RATIOS[ratio].h },
    fps: 30,
    dur: loopSec, // dur === loopSec: one clean loop; static content wraps seam-clean to the frame-0 poster
    bg: ground,
    motion,
    layers: [
      // statement drawn under the lockup; both PRESENT + STATIC (zero-amplitude float). No foreground
      // accent element is emitted — visual interest comes from the animated background.
      { name: 'statement', plate: 'statement.png', float: Object.assign({}, ZERO_FLOAT) },
      { name: 'lockup', plate: 'lockup.png', float: Object.assign({}, ZERO_FLOAT) },
    ],
    out: { codec: 'h264', crf: 18 },
    template: 'hot-take',
    slots: Object.assign({}, slots),
  };
  // Additive-optional: only present for non-default ratios, so an un-ratio'd expand stays as close
  // to a minimal shape as possible (same pattern as new-hire/carousel).
  if (ratio !== '1x1') spec.ratio = ratio;
  return spec;
}

module.exports = {
  name: 'hot-take',
  platesDir: 'templates/hot-take/plates',
  defaults,
  expand,
};
