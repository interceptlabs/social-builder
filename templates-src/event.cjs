/* Event / webinar template (v1.2, Phase 12, NEWT-04) — loop-first model. A promotional event card
 * that is FULLY COMPOSED + legible at frame 0 (the poster): a title + a date/time line + a
 * call-to-action + the canonical lockup, all present and unclipped at every frame. LEGIBILITY IS AN
 * INVARIANT: nothing is ever partially cut or faded — the title, date and CTA read cleanly at frame 0
 * and stay legible throughout the loop.
 *
 * The MOVE is a small, purposeful, loop-safe PULSE driven ENTIRELY by 12-01's new `spec.pulse` +
 * composer.js `pulseTransform` primitive (this template writes NO composer.js code): the CTA gets a
 * gentle scale-bump (a subtle "click me") and the date gets a tiny vertical tick (a quiet
 * animate-the-eye-to-when nudge). Both are endpoint-zero forms — identity at tN=0 AND tN=1 for any
 * integer harmonic — so the poster and the whole-frame loop seam are byte-exact (frame 0 ≡ frame N).
 * The title + lockup are NOT pulse members: they stay perfectly still.
 *
 * Slot -> layer mapping (stable contract for the Phase 5-style content wiring + the Phase 13 builder):
 *   title  -> layer title  (the headline; a string that MAY contain \n for a 2nd line)
 *   date   -> layer date   (a date/time line, e.g. "Thursday, June 12 · 11am PT")
 *   cta    -> layer cta     (a call to action — Flarepop-colored TEXT only, e.g. "Register now →")
 *   lockup -> layer lockup  (canonical 8-path centered mark — never a pulse member; always present)
 *
 * Content is STATIC: every layer explicitly authors a ZERO-amplitude `float` (rather than omitting the
 * field) so composer.js's frozen DEFAULT_FLOAT fallback — still relied on by the frozen legacy
 * fixtures/goldens (scripts/verify-legacy-regression.cjs) — is never reached here; composer.js itself
 * is untouched. No `in`/`rise`/`exit`/`exitDur`/`drift` fields are emitted on any layer.
 *
 * Brand rules (MEMORY): the CTA is Flarepop-colored TEXT, NEVER a filled magenta button/pill/shape
 * (the BRAND-GATE counts magenta fill area — a filled magenta CTA would FAIL it). Canonical 8-path
 * lockup only. NO decorative rule lines / dividers; NO gratuitous numbering.
 */

const { RATIOS, RATIO_KEYS } = require('../ratios.js');

const defaults = {
  // Intercept-flavoured placeholder webinar/event card. \n splits the title into two display lines.
  title: 'Scaling brand\nwithout the drift',
  date: 'Thursday, June 12 · 11am PT',
  cta: 'Register now →',
  lockup: 'centered',
};

// Static content (loop-first, v1.1 lineage — Jon rejected the floaty-text feel): an explicit
// ZERO-amplitude float, not an omitted field, so composer.js's DEFAULT_FLOAT fallback (still needed
// byte-identical for the frozen legacy fixtures/goldens) is never reached — the MOVE is the pulse/tick.
const ZERO_FLOAT = { driftX: 0, driftY: 0, breathe: 0 };

// Pulse tunables (v1.2 contract, fed to composer.js pulseTransform). Modest by design — Jon judges the
// feel at the Phase 13 visual gate. harmonic MUST be a positive integer (endpoint-safety: the
// endpoint-zero sine/cosine forms only return to their tN=0 value at tN=1 for a whole-number harmonic,
// so the loop seam stays byte-exact).
//   cta  — a gentle SCALE pulse (+5% at the peak), twice per loop (a soft "tap me" rhythm).
//   date — a small vertical TICK (±6px), three times per loop (a quiet nudge toward the when).
const PULSE = {
  cta: { scaleAmp: 0.05, harmonic: 2 },
  date: { driftY: 6, harmonic: 3 },
};

const VALID_STYLES = ['keyline', 'fritzoid', 'fan', 'shingle'];
const VALID_PRESETS = ['subtle', 'standard', 'bold'];
const VALID_GROUNDS = ['halo', 'carbon'];

function expand(slots, opts) {
  opts = opts || {};
  // TRANSITION-TIMING (Phase 14): loopSec settable per-post (default 8 => byte-identical). Passthrough
  // opts arrive as strings; composition-spec.js validates motion.speed.loopSec > 0 (rejects bad values).
  const loopSec = opts.loopSec != null ? Number(opts.loopSec) : 8;
  const style = opts.style || 'keyline';
  const preset = opts.preset || 'standard';
  const ratio = opts.ratio || '1x1';
  // An event card reads punchy on dark (bright copy on carbon) — the brand-correct default; both
  // grounds are supported and the CTA stays Flarepop-colored text on either.
  const ground = opts.ground || (slots && slots.ground) || 'carbon';
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`event template: unknown --style="${style}" (expected one of ${VALID_STYLES.join('|')})`);
  }
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(`event template: unknown --preset="${preset}" (expected one of ${VALID_PRESETS.join('|')})`);
  }
  if (!RATIO_KEYS.includes(ratio)) {
    throw new Error(`event template: unknown --ratio="${ratio}" (expected one of ${RATIO_KEYS.join('|')})`);
  }
  if (!VALID_GROUNDS.includes(ground)) {
    throw new Error(`event template: unknown ground="${ground}" (expected one of ${VALID_GROUNDS.join('|')})`);
  }

  // keyline: keep emitting engine:'keyline' (unchanged legacy spec shape) — preset resolution fills
  // cluster/position/movement. fritzoid: no engine field, no keyline-specific hand-tuning.
  const motion = style === 'keyline'
    ? { engine: 'keyline', style, preset, speed: { loopSec } }
    : { style, preset, speed: { loopSec } };

  const spec = {
    size: { w: RATIOS[ratio].w, h: RATIOS[ratio].h },
    fps: 30,
    dur: loopSec, // dur === loopSec: one clean loop; the pulse wraps seam-clean back to the frame-0 poster
    bg: ground,
    motion,
    layers: [
      // All four PRESENT + STATIC (zero-amplitude float). title + lockup stay perfectly still; the
      // cta + date are pulse members (see spec.pulse below), scaled/ticked ON TOP of this zero float.
      { name: 'title', plate: 'title.png', float: Object.assign({}, ZERO_FLOAT) },
      { name: 'date', plate: 'date.png', float: Object.assign({}, ZERO_FLOAT) },
      { name: 'cta', plate: 'cta.png', float: Object.assign({}, ZERO_FLOAT) },
      { name: 'lockup', plate: 'lockup.png', float: Object.assign({}, ZERO_FLOAT) },
    ],
    // The CTA scale-pulse + date vertical-tick — 12-01's pulseTransform reads these per-member
    // amplitudes/harmonics. Endpoint-zero by construction, so tN=0/tN=1 are byte-exact poster + seam.
    // title + lockup are deliberately NOT members (they never move).
    // Pulse amount/harmonic settable per-post (Phase 14): each falls back to the PULSE default (=>
    // byte-identical when unset). composition-spec.js requires each harmonic to be a POSITIVE INTEGER
    // (the endpoint-safety invariant — a non-integer would break the loop seam), so a bad override is
    // REJECTED rather than silently breaking it.
    pulse: {
      members: [
        {
          name: 'cta',
          scaleAmp: opts.ctaScaleAmp != null ? Number(opts.ctaScaleAmp) : PULSE.cta.scaleAmp,
          harmonic: opts.ctaHarmonic != null ? Number(opts.ctaHarmonic) : PULSE.cta.harmonic,
        },
        {
          name: 'date',
          driftY: opts.dateDriftY != null ? Number(opts.dateDriftY) : PULSE.date.driftY,
          harmonic: opts.dateHarmonic != null ? Number(opts.dateHarmonic) : PULSE.date.harmonic,
        },
      ],
    },
    out: { codec: 'h264', crf: 18 },
    template: 'event',
    slots: Object.assign({}, slots),
  };
  // Additive-optional: only present for non-default ratios, so an un-ratio'd expand stays as close to
  // a minimal shape as possible (same pattern as new-hire/hot-take/carousel).
  if (ratio !== '1x1') spec.ratio = ratio;
  return spec;
}

module.exports = {
  name: 'event',
  platesDir: 'templates/event/plates',
  defaults,
  expand,
};
