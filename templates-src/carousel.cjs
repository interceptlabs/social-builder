/* Carousel / multi-beat template — the loop-first CYCLING model (Phase 10, LOOP-04; Jon's 07-26
 * decision "loop-safe beat cycle"). `beats` is a variable-length named slot; ALL authored beats
 * (lockup + beat-1..N) are rendered as PRESENT, STATIC layers (no per-layer drift/parallax/
 * breathe — Jon rejected the floaty-text feel at the v1.1 visual gate, 2026-07-27: "I don't like
 * the floaty text, don't need this feature") — this REPLACES the old v1 sequential stage-in-from-
 * blank timing (`in`/`rise`/`exit`/`exitDur`/`drift`). The BACKGROUND (keyline ribbons / fritzoid
 * truchet+shimmer) still moves; only per-element content motion is gone. Every layer explicitly
 * authors a ZERO-amplitude `float` (rather than omitting the field) so composer.js's frozen
 * DEFAULT_FLOAT fallback — still relied on by the frozen legacy fixtures/goldens
 * (scripts/verify-legacy-regression.cjs) — is never reached here; composer.js itself is untouched.
 *
 * The NEW `spec.beatCycle = { layers, dwell, fade }` contract (built on plan 10-08's composer
 * addition, `beatCycleAlpha`) drives per-frame one-beat-at-a-time visibility: beat-1 (cycle index
 * 0) is centered at loop phase 0, so it is the ONLY beat visible at frame 0 — the poster. Beats
 * advance through the loop one at a time (a quick raised-cosine crossfade between neighbors), and
 * the cycle wraps seam-clean back to beat-1 at `dur` (=== `loopSec`) — drawFrame(0) ===
 * drawFrame(loopSec) byte-for-byte, whole-frame.
 *
 * Cycle timing is fully N-driven: dwell/fade are expressed as a FIXED FRACTION of each beat's own
 * 1/N loop-slot (not an absolute loop fraction), so the one-at-a-time + frame-0-is-beat-1-alone
 * invariant `2*dwell + fade <= 1/N` holds automatically for any authored N (3/4/6/...) with
 * built-in headroom — see DWELL_OF_SLOT/FADE_OF_SLOT below.
 */

const { RATIOS, RATIO_KEYS } = require('../ratios.js');

// defaults.beats: each string is \n-structured into the shipped 3-line markup (templates/carousel/
// plates.html's static beat divs: `Some teams<br>need better<br><span class="accent">intelligence.</span>`
// etc.) — the FINAL \n line is always the accent (Flarepop) line. This exact line structure is what
// the 05-04 injector rebuilds by splitting each beat string on \n and accenting the last line, so the
// default-spec round-trip stays byte-identical to the committed static markup post-injector. A
// single-line default would render as one fully-accented line, silently diverging from the shipped
// plates the moment a default spec routes through the content path (capture-content-plates.cjs
// ALWAYS passes content=).
const defaults = {
  beats: [
    'Some teams\nneed better\nintelligence.',
    'Some teams\nneed greater\nvisibility.',
    'Some teams\nneed more\nvelocity.',
    'Most teams\nneed all four\nworking together.',
  ],
  lockup: 'centered',
};

function round4(x) { return Math.round(x * 10000) / 10000; }

// Resize a beats array to N entries: truncate if shorter, cycle the placeholder copy if longer.
function resizeBeats(beats, n) {
  if (n <= beats.length) return beats.slice(0, n);
  const out = [];
  for (let i = 0; i < n; i++) out.push(beats[i % beats.length]);
  return out;
}

const VALID_STYLES = ['keyline', 'ribbon', 'fritzoid', 'fritzfield'];
const VALID_PRESETS = ['subtle', 'standard', 'bold'];
// 'graphite' (2026-08-04) is a GREY carbon: same ink treatment as carbon (light copy on a
// dark ground) — only the background fill differs — so every plates.html ground rule and every
// preset table entry for carbon applies to it unchanged.
const VALID_GROUNDS = ['halo', 'carbon', 'graphite'];

// Beat-cycle timing (Claude's discretion, 10-CONTEXT — tunable feel, Jon judges at 10-07): each
// beat's dwell/fade are a fixed fraction of its OWN 1/N loop-slot, so:
//   2*DWELL_OF_SLOT + FADE_OF_SLOT === 0.96 <= 1   (a small ~4%-of-slot dark gap reads as a clean
//   cut, not a stutter) — this ratio-based formula keeps `2*dwell + fade <= 1/N` satisfied for ANY
// N without re-tuning. At N=4 (the shipped default) this resolves to dwell=0.09, fade=0.06 — a
// readable plateau hold with a quick crossfade between beats.
const DWELL_OF_SLOT = 0.36;
const FADE_OF_SLOT = 0.24;

// Static content (Phase 10 tuning revision, 2026-07-27 — the floaty-text feature is removed): an
// explicit ZERO-amplitude float, not an omitted field, so composer.js's DEFAULT_FLOAT fallback
// (still needed byte-identical for the frozen legacy fixtures/goldens) is never reached.
const ZERO_FLOAT = { driftX: 0, driftY: 0, breathe: 0 };

function expand(slots, opts) {
  opts = opts || {};
  let beats = Array.isArray(slots && slots.beats) ? slots.beats.slice() : defaults.beats.slice();

  if (opts.beats != null) {
    const n = parseInt(opts.beats, 10);
    if (Number.isFinite(n) && n > 0) beats = resizeBeats(beats, n);
  }

  const style = opts.style || 'keyline';
  const preset = opts.preset || 'standard';
  const ratio = opts.ratio || '1x1';
  const ground = opts.ground || (slots && slots.ground) || 'carbon';
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`carousel template: unknown --style="${style}" (expected one of ${VALID_STYLES.join('|')})`);
  }
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(`carousel template: unknown --preset="${preset}" (expected one of ${VALID_PRESETS.join('|')})`);
  }
  if (!RATIOS[ratio]) {
    throw new Error(`carousel template: unknown --ratio="${ratio}" (expected one of ${RATIO_KEYS.join('|')})`);
  }
  if (!VALID_GROUNDS.includes(ground)) {
    throw new Error(`carousel template: unknown ground="${ground}" (expected one of ${VALID_GROUNDS.join('|')})`);
  }

  const N = beats.length;
  // TRANSITION-TIMING (Phase 14): loopSec settable per-post (default 8 => byte-identical). Passthrough
  // opts arrive as strings; composition-spec.js validates motion.speed.loopSec > 0 (rejects bad values).
  const loopSec = opts.loopSec != null ? Number(opts.loopSec) : 8;

  // RENDERED layers: lockup drawn first/under, then one PRESENT (not staged), STATIC layer per
  // authored beat — the cycling model renders every beat as a real layer; spec.beatCycle (below)
  // is what makes exactly one show at a time. ZERO_FLOAT (not an absent field) keeps content from
  // drifting/breathing.
  const layers = [
    { name: 'lockup', plate: 'lockup.png', float: Object.assign({}, ZERO_FLOAT) },
  ];
  for (let i = 0; i < N; i++) {
    layers.push({ name: `beat-${i + 1}`, plate: `beat-${i + 1}.png`, float: Object.assign({}, ZERO_FLOAT) });
  }

  // spec.beatCycle: beat-1 is cycle index 0 -> centered at loop phase 0 -> the frame-0 poster.
  // dwell/fade are settable per-post (Phase 14): each falls back to the fixed fraction-of-slot default
  // (=> byte-identical when unset). composition-spec.js enforces 2*dwell + fade <= 1/N on the resolved
  // values, so an out-of-range override is REJECTED rather than silently breaking the seam.
  const dwell = opts.dwell != null ? round4(Number(opts.dwell)) : round4(DWELL_OF_SLOT / N);
  const fade = opts.fade != null ? round4(Number(opts.fade)) : round4(FADE_OF_SLOT / N);
  const beatCycle = {
    layers: beats.map((_, i) => `beat-${i + 1}`),
    dwell,
    fade,
  };

  // keyline: keep seed/modes/strings + wan/position (composition choices, not intensity) — the
  // carbon-ground preset now owns ribbon opacity/weight/movement.intensity (Jon 07-22 fix: no more
  // hand-tuned op:0.06 / movement.intensity:0.9 fighting the preset). fritzoid: no engine field,
  // no keyline-specific hand-tuning — this expansion only needs to validate; rendering it lands
  // in 03-02.
  const motion = style === 'keyline'
    ? {
        engine: 'keyline',
        style,
        preset,
        seed: 23,
        modes: ['flarepop', 'coolsweep'],
        strings: 2,
        cluster: { wan: 270 },
        position: { biasX: 0.22, biasY: -0.06 },
        speed: { loopSec },
      }
    : { style, preset, speed: { loopSec } };

  const spec = {
    size: RATIOS[ratio],
    fps: 30,
    dur: loopSec, // dur === loopSec: one clean cycle; wraps seam-clean back to beat-1 (the poster)
    bg: ground,
    motion,
    layers,
    beatCycle,
    out: { codec: 'h264', crf: 18 },
    template: 'carousel',
    slots: Object.assign({}, slots, { beats }),
  };
  // Additive-optional: only emit spec.ratio for non-default ratios, so the default (--ratio
  // omitted) expansion stays as close to the committed Phase 3 sample shape as this v1.1 cycling
  // rewrite allows (see 10-02's plan constraints — regenerating the committed samples is
  // sanctioned; only the ratio field itself stays conditionally additive).
  if (ratio !== '1x1') spec.ratio = ratio;
  return spec;
}

module.exports = {
  name: 'carousel',
  platesDir: 'templates/carousel/plates',
  defaults,
  expand,
};
