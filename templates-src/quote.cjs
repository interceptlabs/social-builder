/* Quote / pull-quote template — Phase 11, NEWT-02 (Wave 2). A full testimonial pull-quote +
 * attribution/role, composed and LEGIBLE at frame 0 (the poster), whose words re-reveal one-by-one
 * mid-loop (a light sweeping word-by-word across the quote) and return EXACTLY to the frame-0
 * poster at loopSec. The reveal is driven ENTIRELY by 11-01's new `spec.wordReveal` + composer.js
 * `wordRevealAlpha` primitive — this template writes NO composer.js code.
 *
 * Loop-first model (LOOP-04, propagated to Phase 11): every layer is present and fully composed at
 * frame 0. Content is STATIC — no per-layer drift/parallax/breathe (Jon rejected the floaty-text
 * feel at the v1.1 visual gate, 2026-07-27: "I don't like the floaty text, don't need this
 * feature") — so every layer explicitly authors a ZERO-amplitude `float` (rather than omitting the
 * field) so composer.js's frozen DEFAULT_FLOAT fallback (still relied on by the frozen legacy
 * fixtures/goldens, scripts/verify-legacy-regression.cjs) is never reached; composer.js itself is
 * untouched. The ONLY per-frame variation of the quote words is the loop-safe alpha dip from
 * `spec.wordReveal` — a pure function of tN that is EXACTLY 1 at tN=0 and tN=1 for every member, so
 * frame 0 is the full legible quote and drawFrame(0) === drawFrame(loopSec) byte-for-byte.
 * attribution/role/lockup are NOT reveal members — they stay full-alpha, always present.
 *
 * Slot -> layer mapping (stable contract for Phase 5 content wiring + Phase 7 builder fields):
 *   quote       -> layers word-1 .. word-N (one PRESENT, STATIC layer per whitespace-split word;
 *                  punctuation stays with the word it trails). These N layers are the wordReveal
 *                  members, in order.
 *   attribution -> layer attribution   (the person / speaker — Flarepop colored text, brand-legal)
 *   role        -> layer role          (title / company — secondary ink)
 *   lockup      -> layer lockup        (canonical 8-path centered mark)
 */

const { RATIOS, RATIO_KEYS } = require('../ratios.js');

// Brand-correct placeholder pull-quote (Intercept-flavored client testimonial). Authored here; the
// static markup in templates/quote/plates.html transcribes it VERBATIM, and the plates.html content
// injector re-splits it with the SAME `.trim().split(/\s+/)` this module uses, so the default-spec
// round-trip (capture-content-plates.cjs ALWAYS passes content=) reproduces byte-stable plates.
const defaults = {
  quote: 'Intercept gave every campaign one clear source of truth.',
  attribution: 'Dana Whitfield',
  role: 'VP Marketing, Northwind Labs',
  lockup: 'centered',
};

// Static content (loop-first, 2026-07-27 — the floaty-text feature is removed): an explicit
// ZERO-amplitude float, not an omitted field, so composer.js's DEFAULT_FLOAT fallback (still needed
// byte-identical for the frozen legacy fixtures/goldens) is never reached.
const ZERO_FLOAT = { driftX: 0, driftY: 0, breathe: 0 };

const VALID_STYLES = ['keyline', 'ribbon', 'fritzoid', 'fritzfield'];
const VALID_PRESETS = ['subtle', 'standard', 'bold'];
// 'graphite' (2026-08-04) is a GREY carbon: same ink treatment as carbon (light copy on a
// dark ground) — only the background fill differs — so every plates.html ground rule and every
// preset table entry for carbon applies to it unchanged.
const VALID_GROUNDS = ['halo', 'carbon', 'graphite'];
// theme is the DARK-LEGIBLE knob for Quote over a dark backgroundVideo (v1.2.5, BG-VIDEO). Quote's
// default palette is black type built for a LIGHT ground — illegible on a dark loop. theme:'dark'
// re-derives the plates in the on-dark palette (white quote/role + Flarepop attribution — the same
// palette Hot-take uses on dark), INDEPENDENTLY of spec.bg (the procedural ground, which is skipped
// under backgroundVideo anyway). theme:'light' (or omitted) = today's behavior EXACTLY: no spec.theme
// is emitted, the query carries no theme= param, and the default (light) Quote stays byte-identical.
const VALID_THEMES = ['light', 'dark'];

// wordReveal tunables (Claude's discretion, this plan's feel — tunable). All four resolve to
// composer.js WORD_REVEAL_DEFAULTS, and satisfy composition-spec.js's loop-interior invariant
// (dipW <= hold AND hold + sweepSpan + dipW <= 1) INDEPENDENTLY of the word count N — the sweep
// lives entirely in the loop interior [hold-dipW, hold+sweepSpan+dipW] = [0.12, 0.88], strictly
// inside (0,1), so wordRevealAlpha is provably EXACTLY 1 at tN=0 and tN=1 for every word (frame-0
// poster + whole-frame seam byte-exact). floor 0.15 = each word momentarily dims to 15% at its dip
// center, reading as a light passing over an always-present quote.
const WORD_REVEAL = { floor: 0.15, dipW: 0.08, sweepSpan: 0.6, hold: 0.2 };

// Split a quote string into words on whitespace; trailing punctuation stays with its word. The
// plates.html injector MUST use this exact same split so the per-word span count stays in lockstep
// with these layers (capture isolates each word via ?only=word-{i}).
function splitWords(quote) {
  return String(quote == null ? '' : quote).trim().split(/\s+/).filter(Boolean);
}

function expand(slots, opts) {
  opts = opts || {};
  // TRANSITION-TIMING (Phase 14): loopSec settable per-post (default 8 => byte-identical). Passthrough
  // opts arrive as strings; composition-spec.js validates motion.speed.loopSec > 0 (rejects bad values).
  const loopSec = opts.loopSec != null ? Number(opts.loopSec) : 8;
  const style = opts.style || 'keyline';
  const preset = opts.preset || 'standard';
  const ratio = opts.ratio || '1x1';
  const ground = opts.ground || (slots && slots.ground) || 'halo';
  const theme = opts.theme || (slots && slots.theme) || 'light';
  if (!VALID_THEMES.includes(theme)) {
    throw new Error(`quote template: unknown theme="${theme}" (expected one of ${VALID_THEMES.join('|')})`);
  }
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`quote template: unknown --style="${style}" (expected one of ${VALID_STYLES.join('|')})`);
  }
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(`quote template: unknown --preset="${preset}" (expected one of ${VALID_PRESETS.join('|')})`);
  }
  if (!RATIO_KEYS.includes(ratio)) {
    throw new Error(`quote template: unknown --ratio="${ratio}" (expected one of ${RATIO_KEYS.join('|')})`);
  }
  if (!VALID_GROUNDS.includes(ground)) {
    throw new Error(`quote template: unknown ground="${ground}" (expected one of ${VALID_GROUNDS.join('|')})`);
  }

  const quote = (slots && typeof slots.quote === 'string' && slots.quote.trim()) ? slots.quote : defaults.quote;
  const words = splitWords(quote);
  const N = words.length;

  // RENDERED layers: one PRESENT, STATIC layer per quote word (the wordReveal members, in order),
  // then attribution, role, and the lockup. Every layer carries an explicit ZERO_FLOAT so content
  // never drifts/breathes. name === plate without '.png' (the capture convention).
  const layers = [];
  for (let i = 0; i < N; i++) {
    layers.push({ name: `word-${i + 1}`, plate: `word-${i + 1}.png`, float: Object.assign({}, ZERO_FLOAT) });
  }
  layers.push({ name: 'attribution', plate: 'attribution.png', float: Object.assign({}, ZERO_FLOAT) });
  layers.push({ name: 'role', plate: 'role.png', float: Object.assign({}, ZERO_FLOAT) });
  layers.push({ name: 'lockup', plate: 'lockup.png', float: Object.assign({}, ZERO_FLOAT) });

  // spec.wordReveal drives 11-01's wordRevealAlpha over EXACTLY the quote words (word-1..word-N in
  // order). attribution/role/lockup are not members, so they stay full-alpha / always present.
  // wordReveal timing is settable per-post (Phase 14): floor/dipW/sweepSpan/hold each fall back to the
  // WORD_REVEAL default (=> byte-identical when unset). composition-spec.js enforces the loop-interior
  // invariant (dipW <= hold AND hold + sweepSpan + dipW <= 1) on the resolved values, so an
  // out-of-range override is REJECTED rather than silently breaking the frame-0 poster / seam.
  const wordReveal = {
    layers: words.map((_, i) => `word-${i + 1}`),
    floor: opts.floor != null ? Number(opts.floor) : WORD_REVEAL.floor,
    dipW: opts.dipW != null ? Number(opts.dipW) : WORD_REVEAL.dipW,
    sweepSpan: opts.sweepSpan != null ? Number(opts.sweepSpan) : WORD_REVEAL.sweepSpan,
    hold: opts.hold != null ? Number(opts.hold) : WORD_REVEAL.hold,
  };

  // keyline: emit engine:'keyline' + style + preset (DEFAULT_MOTION/preset resolution fills the
  // rest). fritzoid: style + preset only, no engine field, no keyline-specific hand-tuning. Mirrors
  // new-hire/carousel exactly.
  const motion = style === 'keyline'
    ? { engine: 'keyline', style, preset, speed: { loopSec } }
    : { style, preset, speed: { loopSec } };

  const spec = {
    size: { w: RATIOS[ratio].w, h: RATIOS[ratio].h },
    fps: 30,
    dur: loopSec, // dur === loopSec: one clean loop; the whole frame wraps seam-clean back to frame 0
    bg: ground,
    motion,
    layers,
    wordReveal,
    out: { codec: 'h264', crf: 18 },
    template: 'quote',
    slots: Object.assign({}, slots, { quote }),
  };
  // Additive-optional: only emit spec.ratio for non-default ratios.
  if (ratio !== '1x1') spec.ratio = ratio;
  // Additive-optional: only emit spec.theme for the dark treatment. Absent (light) = byte-identical
  // to today — capture-content-plates.cjs adds a theme= query param ONLY when spec.theme is present,
  // so the default (light) round-trip stays character-identical.
  if (theme === 'dark') spec.theme = 'dark';
  return spec;
}

module.exports = {
  name: 'quote',
  platesDir: 'templates/quote/plates',
  defaults,
  expand,
};
