// Shared disc rendering utilities — used by both index.html (app.js) and desktop.html.
// Load this script before app.js and before the desktop inline <script>.

const VINYL_COLOR_RULES = [
  { key: "glow in the dark", color: "#16a34a", pattern: /\bglow[\s-]*in[\s-]*the[\s-]*dark\b/ },
  { key: "grape",   color: "#7e22ce", pattern: /\bgrape\b/ },
  { key: "coral",   color: "#fb7185", pattern: /\bcoral\b/ },
  { key: "green",   color: "#16a34a", pattern: /\bgreen\b/ },
  { key: "red",     color: "#dc2626", pattern: /\bred\b/ },
  { key: "blue",    color: "#2563eb", pattern: /\bblue\b/ },
  { key: "yellow",  color: "#eab308", pattern: /\byellow\b/ },
  { key: "orange",  color: "#f97316", pattern: /\borange\b/ },
  { key: "pink",    color: "#ec4899", pattern: /\bpink\b/ },
  { key: "purple",  color: "#8b5cf6", pattern: /\bpurple\b/ },
  { key: "white",   color: "#f8fafc", pattern: /\bwhite\b/ },
  { key: "gold",    color: "#ca8a04", pattern: /\bgold\b/ },
  { key: "silver",  color: "#94a3b8", pattern: /\bsilver\b/ }
];

// ── color helpers ──────────────────────────────────────────────────────────────

function withAlpha(hexColor, alpha) {
  const clean = String(hexColor || "").replace("#", "");
  if (clean.length !== 6) return `rgba(20,20,20,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToRgb(hex) {
  const s = String(hex || "").trim();
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (rgba) return [parseInt(rgba[1]), parseInt(rgba[2]), parseInt(rgba[3])];
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(s);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function isVinylColorDark(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 40;
}

// Returns true for near-white/plain-clear colors (luminance > 200)
function isVinylColorLight(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 200;
}

// Returns lighter and darker shades of a hex color for groove ring CSS values
function discGrooveColors(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return { light: "rgba(255,255,255,0.08)", dark: "rgba(0,0,0,0.10)" };
  const [r, g, b] = rgb;
  const lr = Math.min(255, Math.round(r * 0.5 + 255 * 0.5));
  const lg = Math.min(255, Math.round(g * 0.5 + 255 * 0.5));
  const lb = Math.min(255, Math.round(b * 0.5 + 255 * 0.5));
  return {
    light: `rgba(${lr},${lg},${lb},0.5)`,
    dark:  `rgba(${Math.round(r * 0.45)},${Math.round(g * 0.45)},${Math.round(b * 0.45)},0.5)`
  };
}

// ── disc background builders ───────────────────────────────────────────────────

function buildCdBackground(coverUrl) {
  const cover = coverUrl
    ? `url('${coverUrl}') center / cover`
    : "linear-gradient(145deg, #d8e1ea, #a8b4c3 35%, #e6edf6 65%, #95a1b0)";
  return [
    "radial-gradient(circle at center, transparent 0 8%, rgba(220,225,235,0.95) 8.5% 11.5%, transparent 12%)",
    "radial-gradient(circle at center, transparent 0 80%, rgba(20,30,40,0.82) 80.5% 100%)",
    "conic-gradient(from 10deg, rgba(255,170,170,0.22), rgba(255,240,160,0.22), rgba(170,255,215,0.22), rgba(170,210,255,0.22), rgba(220,170,255,0.22), rgba(255,170,170,0.22))",
    "radial-gradient(circle at 28% 20%, rgba(255,255,255,0.38), transparent 46%)",
    cover
  ].join(", ");
}

// Returns the inline style string for an album-card disc <span>
function buildDiscInlineStyle(isCd, isClear, hexColor, coverUrl) {
  const color = String(hexColor || "#0b0b0b").trim() || "#0b0b0b";
  const safeColor = color.replace(/'/g, "");
  if (isCd) return `background:${buildCdBackground(coverUrl)}`;
  if (isClear) {
    const rgb = hexToRgb(color);
    const accentHex = rgb ? `#${rgb.map(c => c.toString(16).padStart(2, "0")).join("")}` : null;
    if (accentHex && !isVinylColorDark(accentHex) && !isVinylColorLight(accentHex)) {
      const g = discGrooveColors(accentHex);
      return `--vinyl-color:${safeColor};--disc-border-color:${accentHex};--disc-groove-light:${g.light};--disc-groove-dark:${g.dark}`;
    }
    return `--vinyl-color:${safeColor}`;
  }
  if (!isVinylColorDark(color)) {
    const g = discGrooveColors(color);
    return `--vinyl-color:${safeColor};--disc-border-color:${safeColor};--disc-groove-light:${g.light};--disc-groove-dark:${g.dark}`;
  }
  return `--vinyl-color:${safeColor}`;
}

// Applies border / groove / background inline styles to a spinning disc element.
// Call after toggling the element's .clear-vinyl and .cd-disc classes.
function applyDiscStyle(disc, discType, isClear, color, coverUrl) {
  if (discType === "cd") {
    disc.style.background = buildCdBackground(String(coverUrl || "").trim());
    disc.style.removeProperty("--disc-border-color");
    disc.style.removeProperty("--disc-groove-light");
    disc.style.removeProperty("--disc-groove-dark");
  } else if (isClear) {
    const rgb = hexToRgb(color);
    const accentHex = rgb ? `#${rgb.map(c => c.toString(16).padStart(2, "0")).join("")}` : null;
    if (accentHex && !isVinylColorDark(accentHex) && !isVinylColorLight(accentHex)) {
      const g = discGrooveColors(accentHex);
      disc.style.setProperty("--disc-border-color", accentHex);
      disc.style.setProperty("--disc-groove-light", g.light);
      disc.style.setProperty("--disc-groove-dark", g.dark);
    } else {
      disc.style.removeProperty("--disc-border-color");
      disc.style.removeProperty("--disc-groove-light");
      disc.style.removeProperty("--disc-groove-dark");
    }
    disc.style.removeProperty("background");
  } else if (!isVinylColorDark(color)) {
    const g = discGrooveColors(color);
    disc.style.setProperty("--disc-border-color", color);
    disc.style.setProperty("--disc-groove-light", g.light);
    disc.style.setProperty("--disc-groove-dark", g.dark);
    disc.style.removeProperty("background");
  } else {
    disc.style.removeProperty("--disc-border-color");
    disc.style.removeProperty("--disc-groove-light");
    disc.style.removeProperty("--disc-groove-dark");
    disc.style.removeProperty("background");
  }
}

// ── disc metadata detection ────────────────────────────────────────────────────

function resolveVinylColor(rule, translucent) {
  if (!rule || !rule.color) return "#0b0b0b";
  if (translucent && rule.key === "grape") return withAlpha(rule.color, 0.7);
  return translucent ? withAlpha(rule.color, 0.82) : rule.color;
}

function detectAmpersandVinylGradient(text, translucent) {
  const formatDescriptor = String(text || "");
  if (!formatDescriptor.includes("&")) return "";
  const colorRules = VINYL_COLOR_RULES.filter(r => r.key !== "glow in the dark");
  for (const a of colorRules) {
    for (const b of colorRules) {
      if (a.key === b.key) continue;
      const pat = new RegExp(`${a.pattern.source}\\s*&\\s*${b.pattern.source}`);
      if (!pat.test(formatDescriptor)) continue;
      return `linear-gradient(135deg, ${resolveVinylColor(a, translucent)} 0%, ${resolveVinylColor(b, translucent)} 100%)`;
    }
  }
  return "";
}

function detectVinylColors(rawText) {
  const text = String(rawText || "").toLowerCase();
  const segments = text.split(";").map(s => s.trim()).filter(Boolean);
  if (!segments.length) return ["#0b0b0b", ""];

  // Collect up to two colors, scanning each semicolon-separated segment in order.
  // This handles multi-vinyl releases like "Vinyl (Red); Vinyl (Blue)" correctly.
  const collected = [];
  for (const seg of segments) {
    if (collected.length >= 2) break;
    const translucent = /(translucent|transparent|clear)/.test(seg);
    const clearOnly   = /\bclear\b/.test(seg);
    const ampGrad     = detectAmpersandVinylGradient(seg, translucent);
    if (ampGrad) { collected.push(ampGrad); continue; }
    const matched = VINYL_COLOR_RULES.filter(r => r.pattern instanceof RegExp && r.pattern.test(seg));
    if (matched.length >= 2) {
      collected.push(resolveVinylColor(matched[0], translucent));
      if (collected.length < 2) collected.push(resolveVinylColor(matched[1], translucent));
    } else if (matched.length === 1) {
      // Ignore clearOnly when an actual color was found — "clear" may be incidental
      // (e.g. "Green Translucent [Bottle-Green Clear]" should still use green)
      collected.push(resolveVinylColor(matched[0], translucent));
    } else if (translucent) {
      // No color rule matched — fall back to plain clear or generic translucent white
      collected.push(clearOnly ? "#f8fafc" : "rgba(255,255,255,0.88)");
    }
    // segment with no recognized color → skip, keep scanning
  }

  if (!collected.length) return ["#0b0b0b", ""];
  return [collected[0], collected[1] || ""];
}

function detectDiscType(rawText) {
  const text = String(rawText || "").toLowerCase();
  if (!text) return "vinyl";
  const hasVinyl = /\bvinyl\b/.test(text);
  const hasCd    = /\bcd\b|compact\s*disc|cdr|cd-r/.test(text);
  if (hasVinyl && hasCd) return "both";
  if (hasCd) return "cd";
  return "vinyl";
}

function detectDiscCount(rawText) {
  const text = String(rawText || "").toLowerCase();
  const m1 = text.match(/\bx\s*(\d+)\b/);
  if (m1 && Number(m1[1]) > 0) return Number(m1[1]);
  const m2 = text.match(/\b(\d+)\s*x\b/);
  if (m2 && Number(m2[1]) > 0) return Number(m2[1]);
  return 1;
}

function detectClearVinyl(rawText) {
  return /(translucent|transparent|clear)/.test(String(rawText || "").toLowerCase());
}
