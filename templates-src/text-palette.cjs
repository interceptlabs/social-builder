/* Text-color palette (Phase 14, TEXT-CONTROLS) — the SINGLE source of the brand-approved per-slot
 * TEXT colors. Consumed identically by:
 *   - src/composition-spec.js         (validates spec.slots.colors[slot] is a palette key — REJECT
 *                                       anything else, so BRAND stays green BY CONSTRUCTION)
 *   - scripts/capture-content-plates.cjs (resolves a slot's palette TOKEN KEY -> brand hex before it
 *                                       reaches plates.html, so no hex literal is ever hand-typed into
 *                                       a template's source — the BRAND structural gate scans
 *                                       plates.html and stays clean)
 *   - the Phase-15 builder UI          (swatchList() = the exact id/hex/label set the picker shows)
 *   - scripts/verify-text-controls.cjs (asserts every swatch hex is BRAND on-token)
 *
 * DERIVED FROM BRAND TOKENS, never hand-typed:
 *   - carbon / halo / flarepop hexes come DIRECTLY from src/engine.js's brand token tables
 *     (E.BG.carbon / E.BG.halo / E.C.flarepop) — the same tables the renderer paints from.
 *   - the two muted copy inks (carbon-mute / halo-mute) are the copy inks already used in the template
 *     CSS; they are declared here but PROVEN on-token below (every swatch hex must be in
 *     scripts/brand-rules.cjs's ON_TOKEN_HEX allowlist, else this module THROWS at load — an off-brand
 *     swatch can never ship).
 *
 * DELIBERATELY EXCLUDED: wiretree-green (#00d862) and coolsweep-blue (#1a7aff). These saturated brand
 * channel hues are NOT legal as standing text — the BRAND pixel gate flags any wiretree/coolsweep
 * channel-hue pixel in a composed frame. (Historically they appeared only inside the fritzoid glitch
 * effect; that colored glitch was removed in Phase 16 / 16-01, so fritzoid is now fully ink-first and
 * these hues appear nowhere.) Flarepop is the ONLY saturated hue that is brand-legal as colored TEXT
 * (Fritz rule: "Flarepop = colored text").
 */
const E = require('./engine.js');
const { ON_TOKEN_HEX } = require('../scripts/brand-rules.cjs');

// Normalize to lowercase 6-digit hex (matches ON_TOKEN_HEX's normalized form).
function norm(hex) {
  const h = String(hex).trim().toLowerCase();
  const m = h.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) throw new Error(`text-palette: "${hex}" is not a hex color`);
  let d = m[1];
  if (d.length === 3) d = d.split('').map((c) => c + c).join('');
  return '#' + d;
}

// Per-slot font-size multiplier range. sizeScale is a TARGET; the plate's existing overflow auto-fit
// still runs afterward as a safety clamp, so a slot can never overrun its frame regardless.
const SIZE_SCALE_RANGE = { min: 0.6, max: 1.6, default: 1.0 };

// The canonical swatch set. `id` is the stable key; `aliases` are accepted synonyms (the spec/builder
// may use either). `hex` is the applied color.
const TEXT_PALETTE = [
  { id: 'carbon',      hex: norm(E.BG.carbon),  label: 'Carbon (ink)',         aliases: ['ink'] },
  { id: 'halo',        hex: norm(E.BG.halo),    label: 'Halo (white)',         aliases: ['white'] },
  { id: 'flarepop',    hex: norm(E.C.flarepop), label: 'Flarepop (magenta)',   aliases: [] },
  { id: 'carbon-mute', hex: norm('#3a3a4a'),    label: 'Carbon muted (copy)',  aliases: ['ink-mute'] },
  { id: 'halo-mute',   hex: norm('#b9b9c6'),    label: 'Halo muted (copy)',    aliases: ['white-mute'] },
];

// Green-by-construction: every swatch hex MUST be in the canonical BRAND on-token allowlist. If a
// swatch hex ever drifts off-token this THROWS at module load, so composition-spec.js (which validates
// spec colors against PALETTE_KEYS) can only ever accept a brand-legal color.
TEXT_PALETTE.forEach((s) => {
  if (!ON_TOKEN_HEX.has(s.hex)) {
    throw new Error(`text-palette: swatch "${s.id}" hex ${s.hex} is not BRAND on-token (scripts/brand-rules.cjs ON_TOKEN_HEX)`);
  }
});

// key (id or alias) -> hex, for validation + capture-time resolution.
const KEY_TO_HEX = {};
TEXT_PALETTE.forEach((s) => {
  KEY_TO_HEX[s.id] = s.hex;
  s.aliases.forEach((a) => { KEY_TO_HEX[a] = s.hex; });
});
const PALETTE_KEYS = new Set(Object.keys(KEY_TO_HEX));

// token key -> brand hex (undefined for an unknown key — callers validate first).
function resolveColor(key) {
  return KEY_TO_HEX[key];
}

// Canonical id/hex/label list for the builder's swatch picker (aliases included for reference).
function swatchList() {
  return TEXT_PALETTE.map((s) => ({ id: s.id, hex: s.hex, label: s.label, aliases: s.aliases.slice() }));
}

module.exports = { TEXT_PALETTE, PALETTE_KEYS, KEY_TO_HEX, SIZE_SCALE_RANGE, resolveColor, swatchList };
