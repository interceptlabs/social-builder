/* New Hire template — loop-first model (v1.1, Phase 10 propagation of Phase 9's composer core).
 * Originally a faithful port of the shipped "New Hire — Jeff Lewis" square design
 * (intercept-brand-kit/social/new-hire-jeff-lewis/render.cjs CONFIGS[0] staging timings); the v1
 * stage-in-from-blank entrance timings are RETIRED as of this plan.
 *
 * Slot -> layer mapping (stable contract for Phase 5 content wiring + Phase 7 builder fields):
 *   greeting -> layer greeting (single line, wraps naturally at the current scale — an explicit
 *               \n still forces a hard break, same convention as every other text slot)
 *   photo    -> layer photo   (hero cutout; OMITTED entirely from spec.layers when
 *               slots.photo === null — an explicit "no photo" choice, not merely an un-set field)
 *   lockup   -> layer lockup  (canonical 8-path centered mark)
 *   name     -> layer name
 *   role     -> layer role
 *
 * greeting was originally two independently-authored display lines (greeting-1/greeting-2, each
 * its own plate) — retired 2026-08 because a user who only filled in one line still saw the
 * OTHER line's placeholder text (nothing ever cleared it). Collapsed to a single free-text slot
 * that wraps under the same scale-down-then-wrap fit pass every other text slot already used
 * (templates/new-hire/plates.html's fit()) — "one line, wrapping only if the content or scale
 * genuinely needs it," with no second field to leave stale. The old greeting-1.png/greeting-2.png
 * plates remain on disk, referenced only by the frozen legacy-regression fixture
 * (scripts/fixtures/legacy-specs/new-hire-spec.json) — never delete them.
 *
 * Loop-first model (LOOP-04): every layer is present and fully composed at frame 0 — New Hire's
 * plates are non-overlapping (photo/lockup/copy each occupy their own region), so "all layers
 * present at frame 0" IS the settled announcement poster, with no staging order needed. Content
 * is STATIC — no per-layer drift/parallax/breathe (Jon rejected the floaty-text feel at the v1.1
 * visual gate, 2026-07-27: "I don't like the floaty text, don't need this feature") — every layer
 * draws at its home position on every frame, so frame 0 IS every frame content-wise; only the
 * BACKGROUND (keyline ribbons / fritzoid truchet+shimmer) still moves. Every layer explicitly
 * authors a ZERO-amplitude `float` (rather than omitting the field) so composer.js's frozen
 * DEFAULT_FLOAT fallback — still relied on by the frozen legacy fixtures/goldens
 * (scripts/verify-legacy-regression.cjs) — is never reached here; composer.js itself is untouched.
 * Glitch punctuation from the shipped piece remains intentionally EXCLUDED (v2 idea); no
 * `in`/`rise`/`exit`/`exitDur`/`drift` fields are emitted on any layer.
 */

const { RATIOS, RATIO_KEYS } = require('../ratios.js');

const defaults = {
  greeting: 'Welcome to the team.',
  name: 'Jeff Lewis',
  role: 'Head of Client Advisory',
  photo: 'assets/photo-placeholder.png',
  lockup: 'centered',
};

// Static content (Phase 10 tuning revision, 2026-07-27 — the floaty-text feature is removed): an
// explicit ZERO-amplitude float, not an omitted field, so composer.js's DEFAULT_FLOAT fallback
// (still needed byte-identical for the frozen legacy fixtures/goldens) is never reached.
const ZERO_FLOAT = { driftX: 0, driftY: 0, breathe: 0 };

const VALID_STYLES = ['keyline', 'ribbon', 'fritzoid', 'fritzfield'];
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
  const ground = opts.ground || (slots && slots.ground) || 'halo';
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`new-hire template: unknown --style="${style}" (expected one of ${VALID_STYLES.join('|')})`);
  }
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(`new-hire template: unknown --preset="${preset}" (expected one of ${VALID_PRESETS.join('|')})`);
  }
  if (!RATIO_KEYS.includes(ratio)) {
    throw new Error(`new-hire template: unknown --ratio="${ratio}" (expected one of ${RATIO_KEYS.join('|')})`);
  }
  if (!VALID_GROUNDS.includes(ground)) {
    throw new Error(`new-hire template: unknown ground="${ground}" (expected one of ${VALID_GROUNDS.join('|')})`);
  }
  // keyline: keep emitting engine:'keyline' (unchanged spec shape) — DEFAULT_MOTION/preset
  // resolution fills cluster/position/movement. fritzoid: no engine field, no keyline-specific
  // hand-tuning — this expansion only needs to validate; rendering it lands in 03-02.
  const motion = style === 'keyline'
    ? { engine: 'keyline', style, preset, speed: { loopSec } }
    : { style, preset, speed: { loopSec } };
  // An explicit slots.photo === null is "no photo" — the layer is OMITTED entirely rather than
  // pointed at the placeholder, so nothing is captured/composited/exported for it. Any other value
  // (a real path, or the field simply absent) keeps today's behavior exactly: the photo layer is
  // always present and defaults to the placeholder asset.
  const layers = [];
  if (!(slots && slots.photo === null)) {
    layers.push({ name: 'photo', plate: 'photo.png', float: Object.assign({}, ZERO_FLOAT) });
  }
  layers.push(
    { name: 'lockup', plate: 'lockup.png', float: Object.assign({}, ZERO_FLOAT) },
    { name: 'greeting', plate: 'greeting.png', float: Object.assign({}, ZERO_FLOAT) },
    { name: 'name', plate: 'name.png', float: Object.assign({}, ZERO_FLOAT) },
    { name: 'role', plate: 'role.png', float: Object.assign({}, ZERO_FLOAT) },
  );
  const spec = {
    size: { w: RATIOS[ratio].w, h: RATIOS[ratio].h },
    fps: 30,
    dur: loopSec, // dur == loopSec so the clip covers exactly one bg loop
    bg: ground,
    motion,
    layers,
    out: { codec: 'h264', crf: 18 },
    template: 'new-hire',
    slots,
  };
  // Additive-optional: only present when non-default, so an un-ratio'd expand is BYTE-IDENTICAL
  // JSON to Phase 3 output (the locked "specs without ratio unchanged" invariant).
  if (ratio !== '1x1') spec.ratio = ratio;
  return spec;
}

module.exports = {
  name: 'new-hire',
  platesDir: 'templates/new-hire/plates',
  defaults,
  expand,
};
