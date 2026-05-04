---
title: Feature — Vinyl Disc Renderer
tags: [frontend, feature, concept]
updated: 2026-05-03
---

# Feature — Vinyl Disc Renderer

`disc.js` is a shared module loaded by both `index.html` and `desktop.html` before `app.js`. It provides all disc rendering logic: color detection, CSS variable generation, and background builders.

## Color detection — `detectVinylColors(rawText)`

Parses a Discogs format descriptor string (the `rawText` field) and returns `[primaryColor, secondaryColor]` hex strings.

### Input format

Discogs format strings look like:
- `"Vinyl (Red Transparent); Rock, Classic Rock"`
- `"Vinyl (Blue & Green Marbled); Electronic"`
- `"Vinyl (Clear); Hip Hop"`
- `"CD; Rock"`

The function splits on `;` and scans each segment independently.

### Color rules (`VINYL_COLOR_RULES`)

13 named color rules, each with a hex value and a regex pattern:

| Name | Hex | Notes |
|------|-----|-------|
| glow in the dark | `#16a34a` | Matches `glow in the dark` phrase |
| grape | `#7e22ce` | Purple, but dimmer |
| coral | `#fb7185` | |
| green | `#16a34a` | |
| red | `#dc2626` | |
| blue | `#2563eb` | |
| yellow | `#eab308` | |
| orange | `#f97316` | |
| pink | `#ec4899` | |
| purple | `#8b5cf6` | |
| white | `#f8fafc` | |
| gold | `#ca8a04` | |
| silver | `#94a3b8` | |

### Translucency

If a segment contains `translucent`, `transparent`, or `clear`, the matched color is rendered with alpha: `rgba(r,g,b,0.82)`. For the `grape` color specifically, alpha is `0.7` to show more depth.

### Clear vinyl (no color match)

If `clear` is present but no color rule matched: returns `#f8fafc` (near-white). If a more generic translucent descriptor: returns `rgba(255,255,255,0.88)`.

### Bicolor (`&`)

`detectAmpersandVinylGradient()` handles releases like `"Red & Blue Marbled"`. It pairs two color rules, applies alpha if translucent, and returns a `linear-gradient(135deg, colorA 0%, colorB 100%)` CSS gradient string instead of a hex color.

### Multi-disc / two colors

For `"Vinyl (Red); Vinyl (Blue)"`, the function collects up to two colors from separate `;`-delimited segments. The second color becomes `vinylColorSecondary` and drives the secondary disc.

---

## Disc type detection — `detectDiscType(rawText)`

Returns `"vinyl"`, `"cd"`, or `"both"`.

- Scans the full `rawText` for `\bvinyl\b`, `\bcd\b`, `compact disc`, `cdr`, `cd-r`.
- If both vinyl and CD patterns match: `"both"` (renders both disc types, with CD as secondary).
- Defaults to `"vinyl"` if no match.

---

## CSS variable system

Each disc element (`<span class="vinyl-disc">`) is styled with CSS custom properties:

| Variable | Purpose |
|----------|---------|
| `--vinyl-color` | Base disc color |
| `--disc-border-color` | Border color (only set for non-dark vinyl) |
| `--disc-groove-light` | Lighter groove ring color |
| `--disc-groove-dark` | Darker groove ring color |

`buildDiscInlineStyle(isCd, isClear, hexColor, coverUrl)` produces the full inline `style` string for the album grid. `applyDiscStyle(disc, discType, isClear, color, coverUrl)` mutates a live DOM element's style (used in the now-playing section).

### Groove color derivation (`discGrooveColors`)

For non-dark, non-clear vinyl, groove colors are derived from the base color:
- **Light groove**: 50% blend toward white (`rgba(mixedR, mixedG, mixedB, 0.5)`)
- **Dark groove**: 55% darkening of base color (`rgba(r*0.45, g*0.45, b*0.45, 0.5)`)

This creates the subtle groove ring bands visible on colored vinyl.

### Dark vinyl

`isVinylColorDark(hex)` returns true if weighted luminance (BT.601: `0.299R + 0.587G + 0.114B`) is below 40. Dark vinyl (black, very dark colors) skips groove color variables — they wouldn't be visible anyway.

### Light vinyl

`isVinylColorLight(hex)` returns true if luminance > 200. Near-white vinyl skips groove accents too.

---

## CD rendering — `buildCdBackground(coverUrl)`

CDs render as a five-layer CSS background (outermost to innermost):

1. **Hub hole**: transparent `0–8%`, white ring `8.5–11.5%`, transparent `12%+`
2. **Outer edge darkening**: subtle dark vignette at 80–100% radius
3. **Rainbow sheen**: conic gradient with soft pastels — simulates the iridescent rainbow on CD surfaces
4. **Highlight**: radial gradient highlight at 28% 20% (top-left sheen)
5. **Cover art or default gradient**: the album's `coverUrl` at center/cover; if missing, a generic metallic gradient

---

## Usage in the album grid

The disc appears as two `<span>` elements inside `.vinyl-overlay` on each album card:
- `.vinyl-disc-primary` — always rendered
- `.vinyl-disc-secondary` — rendered only for multi-disc or bicolor releases (`hasSecondDisc`)

Both spin via CSS `animation: spin Xs linear infinite`, with the primary disc slower and the secondary slightly faster.

## Usage in now-playing

`applyNowPlayingDiscVisual(nowPlaying)` in `app.js` updates the two spinning discs on the now-playing card:
- Looks up the album in `appState.albums` to get disc metadata.
- Spin speed changes based on `reviewScope`: `"song"` spins faster (`1.9s` / `2.7s`), `"album"` spins slower (`3.8s` / `5.3s`), giving a visual cue about what's being reviewed.

## Related pages

- [[feature-album-collection]] — how discs are used in the album grid
- [[feature-now-playing]] — now-playing card disc rendering
- [[discogs-integration]] — source of `rawText` format descriptor
