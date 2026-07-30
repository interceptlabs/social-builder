/* Stat / number template — Phase 12, NEWT-01 (Wave 2). A hero metric (a big number) + a short
 * supporting line, composed and LEGIBLE at frame 0 (the poster) as the FINAL figure ALONE, whose
 * digits odometer/count-up roll mid-loop and settle back to the EXACT final figure at loopSec
 * (frame 0 === frame N, whole-frame). The roll is driven ENTIRELY by 12-01's new `spec.odometer` +
 * composer.js `odometerAlpha` primitive — this template writes NO composer.js code.
 *
 * Loop-first model (LOOP-04, propagated to Phase 12): every layer is present and fully composed at
 * frame 0. Content is STATIC — no per-layer drift/parallax/breathe (Jon rejected the floaty-text
 * feel at the v1.1 visual gate, 2026-07-27: "I don't like the floaty text, don't need this
 * feature") — so every layer explicitly authors a ZERO-amplitude `float` (rather than omitting the
 * field) so composer.js's frozen DEFAULT_FLOAT fallback (still relied on by the frozen legacy
 * fixtures/goldens, scripts/verify-legacy-regression.cjs) is never reached; composer.js itself is
 * untouched. The ONLY per-frame variation of the hero number is the loop-safe visibility from
 * `spec.odometer` (odometerAlpha) — a pure function of tN that holds member 0 (the FINAL figure)
 * ALONE at exactly tN=0 and tN=1, so frame 0 is the full final figure and drawFrame(0) ===
 * drawFrame(loopSec) byte-for-byte. support/lockup are NOT odometer members — they stay full-alpha.
 *
 * The count-up: expand() emits one PRESENT, STATIC layer per value frame (frame-1..frame-N, where
 * frame-N is the FINAL/exact metric), plus a support layer and a lockup layer. spec.odometer.layers
 * lists frame-N FIRST (member 0 = the rest/poster figure, held across the seam) then the ascending
 * count-up frames frame-1..frame-(N-1) in order, so the loop interior visibly counts UP and settles
 * back on the final figure at the seam. `spec.odometer.rollSpan` sets HOW FAST: the roll is packed
 * into the last `rollSpan` of the loop (member k centered at c = 1 - (N-k)*rollSpan/N), so the figure
 * rests on its final value for the rest of the loop instead of crawling through it.
 *
 * Slot -> layer mapping (stable contract for Phase 5 content wiring + Phase 7 builder fields):
 *   metric  -> layers frame-1 .. frame-N (one PRESENT, STATIC layer per count-up value; frame-N is
 *              the FINAL/exact figure). These N layers are the odometer members (member 0 = frame-N).
 *   support -> layer support   (the short supporting line — secondary ink)
 *   lockup  -> layer lockup    (canonical 8-path centered mark)
 */

const { RATIOS, RATIO_KEYS } = require('../ratios.js');

// Brand-correct placeholder hero stat (Intercept-flavored). Authored here; the static markup in
// templates/stat/plates.html transcribes the derived count-up frames VERBATIM, and the plates.html
// content injector re-derives them with the SAME parseMetric/countUpFrames this module uses, so the
// default-spec round-trip (capture-content-plates.cjs ALWAYS passes content=) reproduces byte-stable
// plates. metric MUST be numeric so the odometer is non-vacuous (the gate proves the roll animates).
const defaults = {
  metric: '87%',
  support: 'of campaigns launched on schedule',
  lockup: 'centered',
};

// Static content (loop-first, 2026-07-27 — the floaty-text feature is removed): an explicit
// ZERO-amplitude float, not an omitted field, so composer.js's DEFAULT_FLOAT fallback (still needed
// byte-identical for the frozen legacy fixtures/goldens) is never reached.
const ZERO_FLOAT = { driftX: 0, driftY: 0, breathe: 0 };

const VALID_STYLES = ['keyline', 'fritzoid'];
const VALID_PRESETS = ['subtle', 'standard', 'bold'];
const VALID_GROUNDS = ['halo', 'carbon'];

// Number of count-up value frames. K=10 gives a DENSE ramp (final/10, 2·final/10, ... final) that
// reads as a mechanical odometer rather than a slideshow of a few numbers — Jon's 2026-07-30 note on
// the v1.1 roll ("doesn't roll fast enough to be cool") is a speed AND granularity call: 6 coarse
// steps spread over the whole loop crawled. MUST stay in lockstep with templates/stat/plates.html's
// COUNT_UP_FRAMES so the per-frame data-plate COUNT matches the odometer member count (capture
// isolates one plate per frame).
const COUNT_UP_FRAMES = 10;

// ROLL SPEED — the fraction of the loop the count-up occupies (spec.odometer.rollSpan). The number
// holds on the final figure for (1 - ROLL_SPAN) of the loop, then rolls through all N values and
// lands back on the final figure at the seam. 0.2 of an 8s loop = a 1.6s roll, i.e. ~0.16s per value
// at N=10 (~5 frames at 30fps) — snappy enough to read as a real odometer, slow enough that each
// value registers. 1 would restore the original whole-loop crawl.
//
// SAMPLING FLOOR: each value gets fps*loopSec*rollSpan/N frames, so pushing rollSpan much below ~0.12
// (at 30fps/8s/N=10) drops under ~3 frames per value and the roll degrades into a blur where some
// values never land on a sampled frame. The loop/poster/seam invariants still hold — it just stops
// reading as a count-up. The builder's roll-speed slider clamps against exactly this bound.
const ROLL_SPAN = 0.2;

// Odometer timing (tunable feel). Each frame's dwell/fade are a fixed fraction of its OWN loop-slot —
// which is now `ROLL_SPAN/N`, not 1/N, since the roll is compressed — exactly like carousel's
// beatCycle, so 12-01's one-at-a-time + final-alone-at-frame-0 invariant `2*dwell + fade <=
// rollSpan/N` holds automatically for ANY N and ANY span with headroom (2*0.36 + 0.24 = 0.96 <= 1 of
// the slot). At N=10, rollSpan=0.2 this resolves to dwell=0.0072, fade=0.0048 — a crisp digit hold
// with a quick raised-cosine flip between values.
const DWELL_OF_SLOT = 0.36;
const FADE_OF_SLOT = 0.24;

function round4(x) { return Math.round(x * 10000) / 10000; }

// Split a metric string into { prefix, numberStr, number, decimals, suffix } around its FIRST numeric
// run (e.g. "87%" -> {prefix:'', numberStr:'87', number:87, decimals:0, suffix:'%'}; "$1.4M" ->
// {prefix:'$', numberStr:'1.4', number:1.4, decimals:1, suffix:'M'}; "3.2x" -> {..'3.2'.., suffix:'x'}).
// Returns null for a non-numeric / unrollable metric (graceful single-frame fallback in expand()).
// The plates.html injector MUST use this exact same parse so its per-frame count matches these layers.
function parseMetric(metric) {
  const s = String(metric == null ? '' : metric);
  const m = s.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const prefix = m[1];
  const numberStr = m[2];
  const suffix = m[3];
  const number = parseFloat(numberStr.replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  const dot = numberStr.indexOf('.');
  const decimals = dot < 0 ? 0 : (numberStr.length - dot - 1);
  return { prefix, numberStr, number, decimals, suffix };
}

// Produce K ascending count-up value frames from a parsed metric, ending EXACTLY on the final figure:
// frames 1..K-1 = round(number * i/K) formatted with the metric's OWN decimals; frame K reuses the
// ORIGINAL numberStr verbatim so frame-K reproduces the metric string EXACTLY (never a toFixed drift).
// Each frame = { prefix, value, suffix, display } (prefix/suffix carried through unchanged). MUST
// stay in lockstep with templates/stat/plates.html's countUpFrames.
function countUpFrames(parsed, K) {
  const frames = [];
  for (let i = 1; i <= K; i++) {
    let value;
    if (i === K) {
      value = parsed.numberStr; // the exact final figure (verbatim)
    } else {
      value = (parsed.number * i / K).toFixed(parsed.decimals);
    }
    frames.push({
      prefix: parsed.prefix,
      value,
      suffix: parsed.suffix,
      display: parsed.prefix + value + parsed.suffix,
    });
  }
  return frames;
}

function expand(slots, opts) {
  opts = opts || {};
  // TRANSITION-TIMING (Phase 14): loopSec settable per-post (default 8 => byte-identical). Passthrough
  // opts arrive as strings; composition-spec.js validates motion.speed.loopSec > 0 (rejects bad values).
  const loopSec = opts.loopSec != null ? Number(opts.loopSec) : 8;
  const style = opts.style || 'keyline';
  const preset = opts.preset || 'standard';
  const ratio = opts.ratio || '1x1';
  const ground = opts.ground || (slots && slots.ground) || 'carbon';
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`stat template: unknown --style="${style}" (expected one of ${VALID_STYLES.join('|')})`);
  }
  if (!VALID_PRESETS.includes(preset)) {
    throw new Error(`stat template: unknown --preset="${preset}" (expected one of ${VALID_PRESETS.join('|')})`);
  }
  if (!RATIO_KEYS.includes(ratio)) {
    throw new Error(`stat template: unknown --ratio="${ratio}" (expected one of ${RATIO_KEYS.join('|')})`);
  }
  if (!VALID_GROUNDS.includes(ground)) {
    throw new Error(`stat template: unknown ground="${ground}" (expected one of ${VALID_GROUNDS.join('|')})`);
  }

  const metric = (slots && typeof slots.metric === 'string' && slots.metric.trim()) ? slots.metric : defaults.metric;
  const support = (slots && typeof slots.support === 'string') ? slots.support : defaults.support;

  // Derive the count-up value frames. A rollable (numeric) metric yields K frames + an odometer; an
  // unrollable metric renders a single verbatim frame with NO odometer (graceful — the metric just
  // holds still). The DEFAULT metric is numeric, so the shipped gate is non-vacuous.
  const parsed = parseMetric(metric);
  const rollable = parsed !== null && COUNT_UP_FRAMES >= 2;
  const frames = rollable
    ? countUpFrames(parsed, COUNT_UP_FRAMES)
    : [{ prefix: '', value: metric, suffix: '', display: metric }];
  const N = frames.length;

  // RENDERED layers: one PRESENT, STATIC layer per value frame (frame-1..frame-N; frame-N = FINAL),
  // then the support line, then the lockup. Every layer carries an explicit ZERO_FLOAT so content
  // never drifts/breathes. name === plate without '.png' (the capture convention).
  const layers = [];
  for (let i = 0; i < N; i++) {
    layers.push({ name: `frame-${i + 1}`, plate: `frame-${i + 1}.png`, float: Object.assign({}, ZERO_FLOAT) });
  }
  layers.push({ name: 'support', plate: 'support.png', float: Object.assign({}, ZERO_FLOAT) });
  layers.push({ name: 'lockup', plate: 'lockup.png', float: Object.assign({}, ZERO_FLOAT) });

  // spec.odometer drives 12-01's odometerAlpha. member 0 = frame-N (the FINAL figure, centered at
  // c=0 -> held ALONE at the frame-0 poster + the seam), then the ascending count-up frames
  // frame-1..frame-(N-1) in order (member k centered at c=k/N). dwell/fade are a fixed fraction of
  // each frame's 1/N slot, so 2*dwell+fade <= 1/N holds for any N.
  // odometer dwell/fade/rollSpan are settable per-post (Phase 14 + the 07-30 roll-speed knob): each
  // falls back to the fixed default (dwell/fade a fraction of the COMPRESSED slot rollSpan/N).
  // composition-spec.js enforces 2*dwell + fade <= rollSpan/N on the resolved values, so an
  // out-of-range override is REJECTED rather than silently breaking the seam.
  let odometer;
  if (rollable) {
    const rollSpan = opts.rollSpan != null ? round4(Number(opts.rollSpan)) : ROLL_SPAN;
    const slot = rollSpan / N; // this member's share of the loop — the invariant's bound
    const dwell = opts.dwell != null ? round4(Number(opts.dwell)) : round4(DWELL_OF_SLOT * slot);
    const fade = opts.fade != null ? round4(Number(opts.fade)) : round4(FADE_OF_SLOT * slot);
    const odLayers = [`frame-${N}`];
    for (let i = 1; i <= N - 1; i++) odLayers.push(`frame-${i}`);
    odometer = { layers: odLayers, dwell, fade, rollSpan };
  }

  // keyline: emit engine:'keyline' + style + preset (DEFAULT_MOTION/preset resolution fills the
  // rest). fritzoid: style + preset only, no engine field, no keyline-specific hand-tuning. Mirrors
  // quote/new-hire/carousel exactly.
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
    out: { codec: 'h264', crf: 18 },
    template: 'stat',
    slots: Object.assign({}, slots, { metric, support }),
  };
  // odometer is additive-optional (absent for an unrollable metric — the number just holds still).
  if (odometer) spec.odometer = odometer;
  // Additive-optional: only emit spec.ratio for non-default ratios.
  if (ratio !== '1x1') spec.ratio = ratio;
  return spec;
}

module.exports = {
  name: 'stat',
  platesDir: 'templates/stat/plates',
  defaults,
  expand,
  // Exported so the content-mode gate (scripts/verify-stat.cjs) can compute the expected per-frame
  // values with the SAME logic and assert plate diffs precisely.
  parseMetric,
  countUpFrames,
  COUNT_UP_FRAMES,
};
