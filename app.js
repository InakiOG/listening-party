const appState = {
  albums: [],
  expandedAlbumId: null,
  sortBy: "date",
  sortDirection: "desc",
  groupBy: null,
  expandedGroupKey: null
};

let pendingAlbumOpenAnimationId = null;

const addAlbumModalState = { coverOptions: [], selectedUrl: "", users: [] };
let addAlbumSearchTimer = null;

const sessionState = {
  currentUser: null
};

const coverFallbackUrl = "./mi%20dise%C3%B1o.png";
const USER_STORAGE_KEY = "listeningPartyUserName";

let lastNowPlayingSignature = "";
let selectedRating = 0;
let currentNowPlaying = null;
const bubbleUiState = new Map();
let activeBubbleDrag = null;
let lastBubbleSignature = "";
const activeUserBubbleUiState = new Map();
let activeUserBubbleDrag = null;
const bubbleEntities = new Map();
let physicsRafId = null;
const userPhotoCache = new Map();
const activeUserBubbleColorCache = new Map();
const topAlbumCoverCache = new Map();
const topAlbumCoverPending = new Map();
const topAlbumCoverOptions = new Map();
const topAlbumCoverUserPick = new Map();
let lastActiveUsersSignature = "";
let lastRenderedActiveUsers = [];
let viewBeforeReviews = "main";

const VINYL_COLOR_RULES = [
  { key: "glow in the dark", color: "#16a34a", pattern: /\bglow[\s-]*in[\s-]*the[\s-]*dark\b/ },
  { key: "grape", color: "#7e22ce", pattern: /\bgrape\b/ },
  { key: "coral", color: "#fb7185", pattern: /\bcoral\b/ },
  { key: "green", color: "#16a34a", pattern: /\bgreen\b/ },
  { key: "red", color: "#dc2626", pattern: /\bred\b/ },
  { key: "blue", color: "#2563eb", pattern: /\bblue\b/ },
  { key: "yellow", color: "#eab308", pattern: /\byellow\b/ },
  { key: "orange", color: "#f97316", pattern: /\borange\b/ },
  { key: "pink", color: "#ec4899", pattern: /\bpink\b/ },
  { key: "purple", color: "#8b5cf6", pattern: /\bpurple\b/ },
  { key: "white", color: "#f8fafc", pattern: /\bwhite\b/ },
  { key: "gold", color: "#ca8a04", pattern: /\bgold\b/ },
  { key: "silver", color: "#94a3b8", pattern: /\bsilver\b/ }
];

const ACTIVE_USER_BUBBLE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899"
];

const ACTIVE_USERS_POLL_INTERVAL_MS = 2000;

function isAdminUser() {
  return String(sessionState.currentUser?.accountName || "").trim().toLowerCase() === "administrador";
}

function normalizeTrackLabel(value) {
  const text = String(value || "").trim();
  return text.replace(/^[A-Z]{1,3}\d+[A-Z]?\s*-\s*/i, "");
}

function withAlpha(hexColor, alpha) {
  const clean = String(hexColor || "").replace("#", "");
  if (clean.length !== 6) {
    return "rgba(20, 20, 20, 0.95)";
  }

  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function resolveVinylColor(rule, translucent) {
  if (!rule || !rule.color) {
    return "#0b0b0b";
  }

  if (translucent && rule.key === "grape") {
    return withAlpha(rule.color, 0.7);
  }

  return translucent ? withAlpha(rule.color, 0.82) : rule.color;
}

function detectAmpersandVinylGradient(text, translucent) {
  const formatDescriptor = String(text || "").split(";")[0] || "";
  if (!formatDescriptor.includes("&")) {
    return "";
  }

  const colorRules = VINYL_COLOR_RULES.filter((rule) => rule.key !== "glow in the dark");

  for (const firstRule of colorRules) {
    for (const secondRule of colorRules) {
      if (firstRule.key === secondRule.key) {
        continue;
      }

      const pairPattern = new RegExp(
        `${firstRule.pattern.source}\\s*&\\s*${secondRule.pattern.source}`
      );

      if (!pairPattern.test(formatDescriptor)) {
        continue;
      }

      const firstColor = resolveVinylColor(firstRule, translucent);
      const secondColor = resolveVinylColor(secondRule, translucent);
      return `linear-gradient(135deg, ${firstColor} 0%, ${secondColor} 100%)`;
    }
  }

  return "";
}

function detectVinylColors(rawText) {
  const text = String(rawText || "").toLowerCase();

  if (!text) {
    return ["#0b0b0b", ""];
  }

  const translucent = /(translucent|transparent|clear)/.test(text);
  const clearOnly = /\bclear\b/.test(text);
  const ampersandGradient = detectAmpersandVinylGradient(text, translucent);
  if (ampersandGradient) {
    return [ampersandGradient, ""];
  }
  const matchedRules = VINYL_COLOR_RULES.filter((rule) => {
    if (rule.pattern instanceof RegExp) {
      return rule.pattern.test(text);
    }
    return false;
  });

  if (matchedRules.length >= 2) {
    return [
      resolveVinylColor(matchedRules[0], translucent),
      resolveVinylColor(matchedRules[1], translucent)
    ];
  }

  if (matchedRules.length === 1) {
    if (clearOnly) {
      return ["#f8fafc", ""];
    }

    return [resolveVinylColor(matchedRules[0], translucent), ""];
  }

  if (translucent) {
    if (clearOnly) {
      return ["#f8fafc", ""];
    }

    return ["rgba(255, 255, 255, 0.88)", ""];
  }

  return ["#0b0b0b", ""];
}

function detectDiscType(rawText) {
  const text = String(rawText || "").toLowerCase();
  if (!text) return "vinyl";
  const hasVinyl = /\bvinyl\b/.test(text);
  const hasCd = /\bcd\b|compact\s*disc|cdr|cd-r/.test(text);
  if (hasVinyl && hasCd) return "both";
  if (hasCd) return "cd";
  return "vinyl";
}

function detectDiscCount(rawText) {
  const text = String(rawText || "").toLowerCase();
  if (!text) {
    return 1;
  }

  const timesMatch = text.match(/\bx\s*(\d+)\b/);
  if (timesMatch && Number(timesMatch[1]) > 0) {
    return Number(timesMatch[1]);
  }

  const prefixMatch = text.match(/\b(\d+)\s*x\b/);
  if (prefixMatch && Number(prefixMatch[1]) > 0) {
    return Number(prefixMatch[1]);
  }

  return 1;
}

function detectClearVinyl(rawText) {
  return /\bclear\b/.test(String(rawText || "").toLowerCase());
}

function extractPrimaryGenre(rawText) {
  const VALID_GENRES = ["Pop", "Rock", "Hip Hop", "Rap", "Jazz", "Electronic", "Soundtrack"];
  const text = String(rawText || "").trim();
  const candidates = text.split(/[;,]/).map(g => g.trim());
  for (const candidate of candidates) {
    if (/vinyl/i.test(candidate)) continue;
    const match = VALID_GENRES.find(g => candidate.toLowerCase().includes(g.toLowerCase()));
    if (match) return match;
  }
  return "Sin género";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUserName(name) {
  return String(name || "").trim();
}

function persistUserName(name) {
  try {
    window.localStorage.setItem(USER_STORAGE_KEY, normalizeUserName(name));
  } catch {
    // Ignore localStorage failures.
  }
}

function clearPersistedUserName() {
  try {
    window.localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures.
  }
}

function getPersistedUserName() {
  try {
    return normalizeUserName(window.localStorage.getItem(USER_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

function setAuthStatus(message) {
  const status = document.getElementById("auth-status");
  if (!status) {
    return;
  }
  status.textContent = message;
}

function showAuthOverlay(message = "") {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) {
    overlay.hidden = false;
  }
  setAuthStatus(message);
}

function hideAuthOverlay() {
  const overlay = document.getElementById("auth-overlay");
  if (overlay) {
    overlay.hidden = true;
  }
  setAuthStatus("");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

async function apiGetUser(name) {
  const response = await fetch(`/api/users?name=${encodeURIComponent(name)}&t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar el perfil.");
  }

  const payload = await response.json();
  return payload && payload.user ? payload.user : null;
}

async function apiGetCurrentUser() {
  const response = await fetch(`/api/users/me?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No se pudo validar sesion.");
  }

  const payload = await response.json();
  return payload && payload.user ? payload.user : null;
}

async function apiLogin(name, password) {
  const response = await fetch("/api/users/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name, password })
  });

  if (response.status === 404) {
    throw new Error("Ese nombre no existe. Crea el usuario primero.");
  }

  if (response.status === 401) {
    throw new Error("Contraseña incorrecta.");
  }

  if (response.status === 403) {
    throw new Error("Ese usuario no tiene Contraseña configurada.");
  }

  if (!response.ok) {
    throw new Error("No se pudo iniciar sesion.");
  }

  const payload = await response.json();
  return payload.user || null;
}

async function apiRegister(name, password, photoDataUrl) {
  const response = await fetch("/api/users/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      password,
      photoDataUrl: photoDataUrl || ""
    })
  });

  if (response.status === 409) {
    throw new Error("Ese nombre ya existe. Usa Entrar.");
  }

  if (!response.ok) {
    throw new Error("No se pudo crear el usuario.");
  }

  const payload = await response.json();
  return payload.user || null;
}

async function apiUpdatePhoto(name, photoDataUrl) {
  const response = await fetch("/api/users/photo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      photoDataUrl
    })
  });

  if (!response.ok) {
    throw new Error("No se pudo actualizar la foto.");
  }

  const payload = await response.json();
  return payload.user || null;
}

async function apiUpdateProfile(name, description, instagramUsername, spotifyUrl, topAlbums) {
  const response = await fetch("/api/users/profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      description,
      instagramUsername,
      spotifyUrl,
      topAlbums
    })
  });

  if (!response.ok) {
    throw new Error("No se pudo guardar el perfil.");
  }

  const payload = await response.json();
  return payload.user || null;
}

async function apiGetMyReviews(name) {
  const response = await fetch(`/api/users/reviews?name=${encodeURIComponent(name)}&t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No se pudieron cargar tus reseñas.");
  }

  const payload = await response.json();
  return Array.isArray(payload.reviews) ? payload.reviews : [];
}

async function apiGetActiveUsers() {
  const response = await fetch(`/api/users/active?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No se pudieron cargar los usuarios activos.");
  }

  const payload = await response.json();
  return Array.isArray(payload.users) ? payload.users : [];
}

async function apiSetNowPlaying(nowPlayingPayload) {
  const response = await fetch("/api/now-playing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(nowPlayingPayload)
  });

  if (response.status === 403) {
    throw new Error("Solo administrador puede iniciar la escucha actual.");
  }

  if (!response.ok) {
    throw new Error("No se pudo actualizar la escucha actual.");
  }

  const payload = await response.json();
  return payload.nowPlaying || null;
}

async function apiClearNowPlaying(actorName) {
  const response = await fetch("/api/now-playing/clear", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ actorName })
  });

  if (response.status === 403) {
    throw new Error("Solo administrador puede finalizar reproduciendo ahora.");
  }

  if (!response.ok) {
    throw new Error("No se pudo finalizar reproduciendo ahora.");
  }

  return response.json();
}

async function apiAddPartyPicture(pictureDataUrl) {
  const response = await fetch("/api/listening-party/picture", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ pictureDataUrl })
  });

  if (response.status === 403) {
    throw new Error("Solo administrador puede agregar fotos.");
  }

  if (!response.ok) {
    throw new Error("No se pudo agregar la foto a la sesion.");
  }

  return response.json();
}

async function apiLogout() {
  const response = await fetch("/api/users/logout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    throw new Error("No se pudo cerrar sesion.");
  }
}

function getProfilePhotoUrl(user) {
  const photo = String(user?.photoDataUrl || "").trim();
  return photo || coverFallbackUrl;
}

function getActiveUserKey(user) {
  return normalizeUserName(user?.name || "").toLowerCase();
}

function getActiveUserBubbleColor(user) {
  const key = getActiveUserKey(user);
  if (!key) {
    return ACTIVE_USER_BUBBLE_COLORS[0];
  }

  if (!activeUserBubbleColorCache.has(key)) {
    const randomIndex = Math.floor(Math.random() * ACTIVE_USER_BUBBLE_COLORS.length);
    activeUserBubbleColorCache.set(key, ACTIVE_USER_BUBBLE_COLORS[randomIndex]);
  }

  return activeUserBubbleColorCache.get(key) || ACTIVE_USER_BUBBLE_COLORS[0];
}

function getActiveUserLetter(user) {
  const trimmed = normalizeUserName(user?.name || "");
  if (!trimmed) {
    return "?";
  }

  return Array.from(trimmed)[0].toUpperCase();
}

function normalizeProfileDescription(value) {
  return String(value || "").trim().slice(0, 150);
}

function normalizeInstagramHandle(value) {
  return String(value || "").trim().replace(/^@+/, "").slice(0, 40);
}

function normalizeSpotifyUrl(value) {
  return String(value || "").trim().slice(0, 200);
}

function isValidSpotifyUrl(value) {
  return !value || value.startsWith("https://open.spotify.com/user/");
}

function normalizeTopAlbums(topAlbums) {
  const source = Array.isArray(topAlbums) ? topAlbums : [];
  const normalized = source
    .slice(0, 3)
    .map((value) => {
      if (value && typeof value === "object") {
        return {
          title: String(value.title || "").trim().slice(0, 150),
          artist: String(value.artist || "").trim().slice(0, 120),
          coverUrl: String(value.coverUrl || "").trim()
        };
      }

      return {
        title: String(value || "").trim().slice(0, 150),
        artist: "",
        coverUrl: ""
      };
    });

  while (normalized.length < 3) {
    normalized.push({
      title: "",
      artist: "",
      coverUrl: ""
    });
  }

  return normalized;
}

function getTopAlbumsFromUser(user) {
  if (Array.isArray(user?.topAlbums)) {
    return normalizeTopAlbums(user.topAlbums);
  }

  return normalizeTopAlbums([
    { title: user?.topAlbum1 || "", artist: user?.topAlbum1Artist || "" },
    { title: user?.topAlbum2 || "", artist: user?.topAlbum2Artist || "" },
    { title: user?.topAlbum3 || "", artist: user?.topAlbum3Artist || "" }
  ]);
}

function refreshActiveUsersBubbleLayer() {
  if (!lastRenderedActiveUsers.length) {
    return;
  }

  lastActiveUsersSignature = "";
  renderActiveUserBubbles(lastRenderedActiveUsers);
}

function getTopAlbumCoverCacheKey(albumTitle, albumArtist) {
  const titleKey = String(albumTitle || "").trim().toLowerCase();
  const artistKey = String(albumArtist || "").trim().toLowerCase();
  if (!titleKey && !artistKey) {
    return "";
  }

  return `${titleKey}::${artistKey}`;
}

function clearTopAlbumCoverCacheEntry(albumTitle, albumArtist) {
  const key = getTopAlbumCoverCacheKey(albumTitle, albumArtist);
  if (!key) {
    return;
  }

  topAlbumCoverCache.delete(key);
  topAlbumCoverPending.delete(key);
  topAlbumCoverOptions.delete(key);
  topAlbumCoverUserPick.delete(key);
}

function getProfileTopAlbumEntriesFromInputs() {
  const album1 = document.getElementById("profile-top-album-1");
  const artist1 = document.getElementById("profile-top-album-1-artist");
  const album2 = document.getElementById("profile-top-album-2");
  const artist2 = document.getElementById("profile-top-album-2-artist");
  const album3 = document.getElementById("profile-top-album-3");
  const artist3 = document.getElementById("profile-top-album-3-artist");

  return normalizeTopAlbums([
    { title: album1?.value || "", artist: artist1?.value || "" },
    { title: album2?.value || "", artist: artist2?.value || "" },
    { title: album3?.value || "", artist: artist3?.value || "" }
  ]);
}

function refreshProfileTopAlbumPreviews() {
  const entries = getProfileTopAlbumEntriesFromInputs();

  entries.forEach((entry, index) => {
    const num = index + 1;
    const image = document.getElementById(`profile-top-album-${num}-cover`);
    const emptyLabel = document.getElementById(`profile-top-album-${num}-cover-empty`);

    if (!image || !emptyLabel) {
      return;
    }

    if (!entry.title) {
      image.hidden = true;
      image.removeAttribute("src");
      emptyLabel.textContent = "Sin portada";
      const picker = document.getElementById(`profile-top-album-${num}-picker`);
      if (picker) picker.innerHTML = "";
      return;
    }

    const coverUrl = ensureTopAlbumCover(entry.title, entry.artist);

    if (coverUrl) {
      image.src = coverUrl;
      image.hidden = false;
      emptyLabel.textContent = "";
    } else {
      image.hidden = true;
      image.removeAttribute("src");
      emptyLabel.textContent = "Buscando portada...";
    }

    renderTopAlbumPicker(num, entry.title, entry.artist);
  });
}

async function fetchTopAlbumCover(albumTitle, albumArtist) {
  const title = String(albumTitle || "").trim();
  const artist = String(albumArtist || "").trim();

  if (!title && !artist) return [];

  function norm(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Source 1 & 2 & 3: iTunes with different query strategies
  async function fetchItunes(query) {
    try {
      const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=10`);
      if (!res.ok) return [];
      const payload = await res.json();
      return (Array.isArray(payload?.results) ? payload.results : []).flatMap(r => {
        const raw = String(r?.artworkUrl100 || r?.artworkUrl60 || "").trim();
        const url = raw.replace(/\d+x\d+bb/, "600x600bb");
        return url ? [{ url, collectionName: r.collectionName || "", artistName: r.artistName || "" }] : [];
      });
    } catch { return []; }
  }

  // Source 4: MusicBrainz search + Cover Art Archive
  async function fetchCoverArtArchive() {
    try {
      const q = [artist && `artist:"${artist}"`, title && `release:"${title}"`].filter(Boolean).join(" AND ");
      const mbRes = await fetch(
        `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=5`,
        { headers: { "User-Agent": "ListeningParty/1.0 (local)" } }
      );
      if (!mbRes.ok) return [];
      const mbData = await mbRes.json();
      return (Array.isArray(mbData?.releases) ? mbData.releases : []).slice(0, 5).flatMap(r => {
        if (!r.id) return [];
        const artistName = (r["artist-credit"] || []).map(ac => ac.name || ac.artist?.name || "").filter(Boolean).join(", ");
        return [{ url: `https://coverartarchive.org/release/${r.id}/front-500`, collectionName: r.title || "", artistName }];
      });
    } catch { return []; }
  }

  // Source 5: Deezer
  async function fetchDeezer(query) {
    try {
      const res = await fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=10`);
      if (!res.ok) return [];
      const payload = await res.json();
      return (Array.isArray(payload?.data) ? payload.data : []).flatMap(r => {
        const url = r.cover_xl || r.cover_big || r.cover_medium || "";
        return url ? [{ url, collectionName: r.title || "", artistName: r.artist?.name || "" }] : [];
      });
    } catch { return []; }
  }

  const normTitle = norm(title);
  const normArtist = norm(artist);
  const combinedQuery = [artist, title].filter(Boolean).join(" ");
  // Alternate title handles "The Dark Side of the Moon" ↔ "Dark Side of the Moon" cases
  const altTitle = title.toLowerCase().startsWith("the ") ? title.slice(4) : `The ${title}`;
  const altQuery = [artist, altTitle].filter(Boolean).join(" ");

  const settled = await Promise.allSettled([
    fetchItunes(combinedQuery),            // source 1: iTunes artist+title
    fetchItunes(altQuery),                 // source 2: iTunes with "The " toggled
    fetchItunes(title),                    // source 3: iTunes title-only
    fetchCoverArtArchive(),                // source 4: MusicBrainz + Cover Art Archive
    fetchDeezer(combinedQuery),            // source 5: Deezer
  ]);

  // Merge and dedup by URL
  const seen = new Set();
  const merged = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }

  if (!merged.length) return [];

  function score(o) {
    const t = norm(o.collectionName);
    const ar = norm(o.artistName);
    const titleMatch = t === normTitle || t.includes(normTitle) || normTitle.includes(t) ||
      t === norm(altTitle) || t.includes(norm(altTitle));
    const artistMatch = !normArtist || ar === normArtist || ar.includes(normArtist) || normArtist.includes(ar);
    if (titleMatch && artistMatch) return 0;
    if (titleMatch) return 1;
    if (artistMatch) return 2;
    return 3;
  }

  merged.sort((a, b) => score(a) - score(b));
  return merged.slice(0, 5);
}

function ensureTopAlbumCover(albumTitle, albumArtist) {
  const key = getTopAlbumCoverCacheKey(albumTitle, albumArtist);

  if (!key) {
    return "";
  }

  if (topAlbumCoverUserPick.has(key)) {
    return topAlbumCoverUserPick.get(key) || "";
  }

  if (topAlbumCoverCache.has(key)) {
    return topAlbumCoverCache.get(key) || "";
  }

  if (topAlbumCoverPending.has(key)) {
    return "";
  }

  const task = fetchTopAlbumCover(albumTitle, albumArtist)
    .then((options) => {
      topAlbumCoverOptions.set(key, options || []);
      const bestUrl = options.length ? options[0].url : "";
      topAlbumCoverCache.set(key, bestUrl);
      topAlbumCoverPending.delete(key);
      refreshActiveUsersBubbleLayer();
      refreshProfileTopAlbumPreviews();
    })
    .catch(() => {
      topAlbumCoverCache.set(key, "");
      topAlbumCoverPending.delete(key);
    });

  topAlbumCoverPending.set(key, task);
  return "";
}

function renderTopAlbumPicker(index, albumTitle, albumArtist) {
  const picker = document.getElementById(`profile-top-album-${index}-picker`);
  if (!picker) return;

  const key = getTopAlbumCoverCacheKey(albumTitle, albumArtist);
  const options = topAlbumCoverOptions.get(key) || [];
  const selectedUrl = topAlbumCoverUserPick.get(key) || topAlbumCoverCache.get(key) || "";

  if (options.length <= 1) {
    picker.innerHTML = "";
    return;
  }

  picker.innerHTML = options.map((opt) => {
    const isSelected = opt.url === selectedUrl;
    const label = [opt.collectionName, opt.artistName].filter(Boolean).join(" – ");
    return `<button type="button" class="${isSelected ? "selected" : ""}" title="${escapeHtml(label)}" data-url="${escapeHtml(opt.url)}" data-index="${index}" data-title="${escapeHtml(albumTitle)}" data-artist="${escapeHtml(albumArtist)}"><img src="${escapeHtml(opt.url)}" alt="${escapeHtml(label)}" loading="lazy" onerror="this.closest('button').style.display='none'" /></button>`;
  }).join("");
}

function handleTopAlbumPickerClick(e) {
  const btn = e.target.closest("button[data-url][data-index]");
  if (!btn || !btn.closest(".profile-top-album-picker")) return;

  const url = btn.dataset.url;
  const index = btn.dataset.index;
  const albumTitle = btn.dataset.title;
  const albumArtist = btn.dataset.artist;
  const key = getTopAlbumCoverCacheKey(albumTitle, albumArtist);

  topAlbumCoverUserPick.set(key, url);

  const image = document.getElementById(`profile-top-album-${index}-cover`);
  const emptyLabel = document.getElementById(`profile-top-album-${index}-cover-empty`);
  if (image) { image.src = url; image.hidden = false; }
  if (emptyLabel) emptyLabel.textContent = "";

  renderTopAlbumPicker(Number(index), albumTitle, albumArtist);
}

function renderActiveUserBubbles(users) {
  const layer = document.getElementById("active-users-layer");
  if (!layer) {
    return;
  }

  const normalizedUsers = Array.isArray(users) ? users : [];
  const limitedUsers = normalizedUsers.slice(0, 14);
  lastRenderedActiveUsers = limitedUsers;
  const signature = JSON.stringify(
    limitedUsers.map((user) => ({
      name: String(user?.name || ""),
      photoDataUrl: String(user?.photoDataUrl || ""),
      description: normalizeProfileDescription(user?.description || ""),
      instagramUsername: normalizeInstagramHandle(user?.instagramUsername || ""),
      spotifyUrl: normalizeSpotifyUrl(user?.spotifyUrl || ""),
      topAlbums: getTopAlbumsFromUser(user).map((entry) => ({
        title: entry.title,
        artist: entry.artist
      }))
    }))
  );

  if (signature === lastActiveUsersSignature) {
    return;
  }

  if (!limitedUsers.length) {
    layer.innerHTML = "";
    lastRenderedActiveUsers = [];
    lastActiveUsersSignature = signature;
    syncBubblesFromDom();
    return;
  }

  layer.innerHTML = limitedUsers
    .map((user, index) => {
      const userKey = getActiveUserKey(user) || `${String(user?.name || "").toLowerCase()}::${index}`;
      const encodedUserKey = encodeURIComponent(userKey);
      const savedState = activeUserBubbleUiState.get(userKey);
      const expanded = Boolean(savedState?.expanded);
      const safeName = escapeHtml(String(user?.name || "Usuario"));
      const photoUrl = String(user?.photoDataUrl || "").trim();
      const hasPhoto = Boolean(photoUrl);
      const safePhotoUrl = escapeHtml(photoUrl);
      const letter = escapeHtml(getActiveUserLetter(user));
      const color = escapeHtml(getActiveUserBubbleColor(user));
      const description = escapeHtml(normalizeProfileDescription(user?.description || ""));
      const instagram = escapeHtml(normalizeInstagramHandle(user?.instagramUsername || ""));
      const spotify = escapeHtml(normalizeSpotifyUrl(user?.spotifyUrl || ""));
      const topAlbums = getTopAlbumsFromUser(user).filter((entry) => entry.title);
      const descriptionMarkup = description
        ? `<p class="active-user-detail-value">${description}</p>`
        : `<p class="active-user-detail-value active-user-detail-empty">Sin descripcion.</p>`;
      const instagramMarkup = instagram
        ? `<p class="active-user-detail-value"><button type="button" class="active-user-instagram-link" data-instagram="${instagram}">@${instagram}</button></p>`
        : `<p class="active-user-detail-value active-user-detail-empty">Sin Instagram.</p>`;
      const spotifyMarkup = spotify
        ? `<p class="active-user-detail-value"><button type="button" class="active-user-spotify-link" data-spotify="${spotify}">Abrir Spotify</button></p>`
        : `<p class="active-user-detail-value active-user-detail-empty">Sin Spotify.</p>`;
      const topAlbumsMarkup = topAlbums.length
        ? topAlbums
            .map((entry) => {
              const safeAlbumTitle = escapeHtml(entry.title);
              const safeAlbumArtist = escapeHtml(entry.artist || "");
              const displayText = safeAlbumArtist
                ? `${safeAlbumTitle} - ${safeAlbumArtist}`
                : safeAlbumTitle;
              const coverUrl = entry.coverUrl || ensureTopAlbumCover(entry.title, entry.artist);
              const safeCoverUrl = escapeHtml(coverUrl);
              const artworkMarkup = safeCoverUrl
                ? `<img src="${safeCoverUrl}" alt="Portada de ${safeAlbumTitle}" loading="lazy" />`
                : `<span class="active-user-top-album-placeholder">♪</span>`;

              return `
                <li class="active-user-top-album-item">
                  <span class="active-user-top-album-art">${artworkMarkup}</span>
                  <span class="active-user-top-album-title">${displayText}</span>
                </li>
              `;
            })
            .join("")
        : `<li class="active-user-top-album-item active-user-detail-empty">Sin top albums.</li>`;

      return `
        <article class="active-user-bubble ${expanded ? "expanded" : ""}" data-user-key="${encodedUserKey}" title="${safeName}" style="left:0;top:0;">
          ${hasPhoto
            ? `<img src="${safePhotoUrl}" alt="Foto de ${safeName}" loading="lazy" />`
            : `<span class="active-user-letter" style="background:${color};">${letter}</span>`}
          <div class="active-user-bubble-details">
            <p class="active-user-detail-name">${safeName}</p>
            <p class="active-user-detail-label">Descripcion</p>
            ${descriptionMarkup}
            <p class="active-user-detail-label">Instagram</p>
            ${instagramMarkup}
            <p class="active-user-detail-label">Spotify</p>
            ${spotifyMarkup}
            <p class="active-user-detail-label">Top albums</p>
            <ul class="active-user-top-albums-list">${topAlbumsMarkup}</ul>
          </div>
        </article>
      `;
    })
    .join("");

  lastActiveUsersSignature = signature;
  syncBubblesFromDom();
}

function startActiveUsersPolling() {
  const refresh = () => {
    apiGetActiveUsers()
      .then((users) => {
        renderActiveUserBubbles(users);
      })
      .catch(() => {
        renderActiveUserBubbles([]);
      });
  };

  refresh();
  window.setInterval(refresh, ACTIVE_USERS_POLL_INTERVAL_MS);
}

function refreshActiveUsersNow() {
  return apiGetActiveUsers()
    .then((users) => {
      renderActiveUserBubbles(users);
    })
    .catch(() => {
      // Ignore transient refresh failures.
    });
}

function setCurrentUser(user) {
  sessionState.currentUser = user || null;
  const profileHub = document.getElementById("profile-hub");
  const profileAvatar = document.getElementById("profile-avatar");
  const profileMenuUser = document.getElementById("profile-menu-user");
  const profilePartyCount = document.getElementById("profile-party-count");
  const profileDescription = document.getElementById("profile-description");
  const profileInstagram = document.getElementById("profile-instagram");
  const profileTopAlbum1 = document.getElementById("profile-top-album-1");
  const profileTopAlbum1Artist = document.getElementById("profile-top-album-1-artist");
  const profileTopAlbum2 = document.getElementById("profile-top-album-2");
  const profileTopAlbum2Artist = document.getElementById("profile-top-album-2-artist");
  const profileTopAlbum3 = document.getElementById("profile-top-album-3");
  const profileTopAlbum3Artist = document.getElementById("profile-top-album-3-artist");
  const profileSaveStatus = document.getElementById("profile-save-status");
  const reviewerName = document.getElementById("reviewer-name");
  const nowPlayingControls = document.getElementById("now-playing-controls");

  if (!sessionState.currentUser) {
    clearPersistedUserName();
    if (profileHub) {
      profileHub.hidden = true;
    }
    if (reviewerName) {
      reviewerName.value = "";
    }
    if (profileDescription) {
      profileDescription.value = "";
    }
    if (profilePartyCount) {
      profilePartyCount.textContent = "";
    }
    if (profileInstagram) {
      profileInstagram.value = "";
    }
    if (profileSaveStatus) {
      profileSaveStatus.textContent = "";
    }
    if (profileTopAlbum1) {
      profileTopAlbum1.value = "";
    }
    if (profileTopAlbum2) {
      profileTopAlbum2.value = "";
    }
    if (profileTopAlbum1Artist) {
      profileTopAlbum1Artist.value = "";
    }
    if (profileTopAlbum2Artist) {
      profileTopAlbum2Artist.value = "";
    }
    if (profileTopAlbum3Artist) {
      profileTopAlbum3Artist.value = "";
    }
    if (profileTopAlbum3) {
      profileTopAlbum3.value = "";
    }
    if (nowPlayingControls) {
      nowPlayingControls.hidden = true;
    }
    const addAlbumFabLogout = document.getElementById("add-album-button");
    if (addAlbumFabLogout) addAlbumFabLogout.hidden = true;
    renderAlbums();
    return;
  }

  persistUserName(sessionState.currentUser.name || "");

  if (profileHub) {
    profileHub.hidden = false;
  }

  if (profileAvatar) {
    profileAvatar.src = getProfilePhotoUrl(sessionState.currentUser);
  }

  if (profileMenuUser) {
    profileMenuUser.textContent = `Perfil: ${sessionState.currentUser.name}`;
  }

  if (profilePartyCount) {
    const count = Number(sessionState.currentUser.listeningPartiesAttended || 0);
    const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    profilePartyCount.textContent = `Listening partys asistidas: ${normalizedCount}`;
  }

  if (profileDescription) {
    profileDescription.value = String(sessionState.currentUser.description || "").trim();
  }

  if (profileInstagram) {
    profileInstagram.value = String(sessionState.currentUser.instagramUsername || "").trim();
  }

  const profileSpotifyEl = document.getElementById("profile-spotify");
  const profileSpotifyErrorEl = document.getElementById("profile-spotify-error");
  if (profileSpotifyEl) {
    profileSpotifyEl.value = String(sessionState.currentUser.spotifyUrl || "").trim();
  }
  if (profileSpotifyErrorEl) profileSpotifyErrorEl.hidden = true;

  const topAlbums = getTopAlbumsFromUser(sessionState.currentUser);
  if (profileTopAlbum1) {
    profileTopAlbum1.value = topAlbums[0]?.title || "";
  }
  if (profileTopAlbum1Artist) {
    profileTopAlbum1Artist.value = topAlbums[0]?.artist || "";
  }
  if (profileTopAlbum2) {
    profileTopAlbum2.value = topAlbums[1]?.title || "";
  }
  if (profileTopAlbum2Artist) {
    profileTopAlbum2Artist.value = topAlbums[1]?.artist || "";
  }
  if (profileTopAlbum3) {
    profileTopAlbum3.value = topAlbums[2]?.title || "";
  }
  if (profileTopAlbum3Artist) {
    profileTopAlbum3Artist.value = topAlbums[2]?.artist || "";
  }

  // Restore user-picked covers from persisted coverUrl so the right image shows without re-fetching
  topAlbums.forEach((entry) => {
    if (entry.coverUrl && entry.title) {
      const key = getTopAlbumCoverCacheKey(entry.title, entry.artist);
      if (key) {
        topAlbumCoverUserPick.set(key, entry.coverUrl);
        topAlbumCoverCache.set(key, entry.coverUrl);
      }
    }
  });

  refreshProfileTopAlbumPreviews();

  if (profileSaveStatus) {
    profileSaveStatus.textContent = "";
  }

  if (reviewerName) {
    reviewerName.value = sessionState.currentUser.name || "";
  }

  if (nowPlayingControls) {
    nowPlayingControls.hidden = !isAdminUser();
  }

  const addAlbumFab = document.getElementById("add-album-button");
  if (addAlbumFab) addAlbumFab.hidden = !isAdminUser();

  const openUsersBoardButton = document.getElementById("open-users-board");
  if (openUsersBoardButton) {
    openUsersBoardButton.hidden = !isAdminUser();
  }

  hideAuthOverlay();
  renderAlbums();
}

function getAlbumById(albumId) {
  return appState.albums.find((album) => String(album.id) === String(albumId)) || null;
}

function getAlbumDateValue(album) {
  const parsed = Date.parse(String(album?.dateAdded || ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getAlbumScoreValue(album) {
  const parsed = Number(album?.score);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAlbumTimesPlayedValue(album) {
  const parsed = Number(album?.timesPlayed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getSortedAlbums() {
  const direction = appState.sortDirection === "asc" ? 1 : -1;
  const sortBy = appState.sortBy;

  return appState.albums
    .slice()
    .sort((a, b) => {
      if (sortBy === "artist") {
        const value = String(a.artist || "").localeCompare(String(b.artist || ""), undefined, { sensitivity: "base" });
        if (value !== 0) {
          return value * direction;
        }
      } else if (sortBy === "genre") {
        const value = String(a.primaryGenre || "").localeCompare(String(b.primaryGenre || ""), undefined, { sensitivity: "base" });
        if (value !== 0) {
          return value * direction;
        }
      } else if (sortBy === "title") {
        const value = String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
        if (value !== 0) {
          return value * direction;
        }
      } else if (sortBy === "score") {
        const value = getAlbumScoreValue(a) - getAlbumScoreValue(b);
        if (value !== 0) {
          return value * direction;
        }
      } else if (sortBy === "timesPlayed") {
        const value = getAlbumTimesPlayedValue(a) - getAlbumTimesPlayedValue(b);
        if (value !== 0) {
          return value * direction;
        }
      } else {
        const value = getAlbumDateValue(a) - getAlbumDateValue(b);
        if (value !== 0) {
          return value * direction;
        }
      }

      const artistTieBreak = String(a.artist || "").localeCompare(String(b.artist || ""), undefined, { sensitivity: "base" });
      if (artistTieBreak !== 0) {
        return artistTieBreak;
      }

      return String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" });
    });
}

function sortAlbumsInState() {
  appState.albums = getSortedAlbums();
}

function findAlbumByNowPlaying(nowPlaying) {
  if (!nowPlaying) {
    return null;
  }

  const targetTitle = String(nowPlaying.albumTitle || "").trim().toLowerCase();
  const targetArtist = String(nowPlaying.albumArtist || "").trim().toLowerCase();

  if (!targetTitle) {
    return null;
  }

  return appState.albums.find((album) => {
    const albumTitle = String(album.title || "").trim().toLowerCase();
    const albumArtist = String(album.artist || "").trim().toLowerCase();

    if (albumTitle !== targetTitle) {
      return false;
    }

    if (!targetArtist) {
      return true;
    }

    return albumArtist === targetArtist;
  }) || null;
}

function getAlbumGroupKey(album) {
  if (!album) {
    return null;
  }

  if (appState.groupBy === "genre") {
    return album.primaryGenre || "Sin género";
  }

  if (appState.groupBy === "artist") {
    return album.artist || "Unknown";
  }

  if (appState.groupBy === "owner") {
    return album.isLive && album.owner ? album.owner : "Iñaki";
  }

  return null;
}

function updateGroupByButtonStates() {
  const groupByArtistButton = document.getElementById("group-by-artist");
  const groupByGenreButton = document.getElementById("group-by-genre");
  const groupByOwnerButton = document.getElementById("group-by-owner");

  if (groupByArtistButton) {
    groupByArtistButton.classList.toggle("active", appState.groupBy === "artist");
  }

  if (groupByGenreButton) {
    groupByGenreButton.classList.toggle("active", appState.groupBy === "genre");
  }

  if (groupByOwnerButton) {
    groupByOwnerButton.classList.toggle("active", appState.groupBy === "owner");
  }
}

function openAlbumInGrid(album, showMain = true) {
  if (!album) {
    return;
  }

  if (showMain) {
    const mainView = document.getElementById("main-view");
    if (!mainView || mainView.hidden) {
      showMainView();
    }
  }

  // Always show the full album grid before opening a specific album.
  appState.groupBy = null;
  appState.expandedGroupKey = null;
  updateGroupByButtonStates();

  appState.expandedAlbumId = album.id;
  pendingAlbumOpenAnimationId = album.id;
  renderAlbums();

  if (pendingAlbumOpenAnimationId) {
    runAlbumOpenAnimation(pendingAlbumOpenAnimationId);
    pendingAlbumOpenAnimationId = null;
  }

  const coverButton = Array.from(document.querySelectorAll(".cover-button"))
    .find((element) => String(element.dataset.albumId || "") === String(album.id));
  if (coverButton && typeof coverButton.scrollIntoView === "function") {
    coverButton.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function openNowPlayingAlbumInGrid() {
  const album = findAlbumByNowPlaying(currentNowPlaying);
  if (!album) {
    showReviewStatus("No se encontro el album en la lista.");
    return;
  }

  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");
  if (reviewsView && !reviewsView.hidden) {
    showMainView();
  }
  if (profileView && !profileView.hidden) {
    showMainView();
  }

  openAlbumInGrid(album, false);
}

function animateCoverToNowPlaying(sourceImg) {
  if (!sourceImg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  const sourceRect = sourceImg.getBoundingClientRect();
  if (!sourceRect.width || !sourceRect.height) return;

  const npCover = document.getElementById("now-playing-cover");
  const npSection = document.getElementById("now-playing");
  let targetRect;
  if (npSection && !npSection.hidden && npCover) {
    targetRect = npCover.getBoundingClientRect();
  } else {
    const widgetW = Math.min(window.innerWidth * 0.96, 420);
    const widgetLeft = (window.innerWidth - widgetW) / 2;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    targetRect = { left: widgetLeft + rem * 0.5, top: rem * 0.6 + rem * 0.5, width: 46, height: 46 };
  }

  const clone = document.createElement("img");
  clone.src = sourceImg.src;
  clone.setAttribute("aria-hidden", "true");
  clone.style.cssText = `position:fixed;pointer-events:none;z-index:9999;border-radius:0.4rem;object-fit:cover;will-change:transform,opacity;width:${sourceRect.width}px;height:${sourceRect.height}px;top:${sourceRect.top}px;left:${sourceRect.left}px;`;
  document.body.appendChild(clone);

  const targetScale = Math.min(targetRect.width / sourceRect.width, targetRect.height / sourceRect.height);
  const targetLeft = targetRect.left + (targetRect.width - sourceRect.width * targetScale) / 2;
  const targetTop = targetRect.top + (targetRect.height - sourceRect.height * targetScale) / 2;
  const arcMidX = (sourceRect.left + targetLeft) / 2;
  const arcMidY = Math.min(sourceRect.top, targetTop) - 80;
  const midScale = (1 + targetScale) / 2;

  const anim = clone.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 1, boxShadow: "0 8px 32px rgba(0,0,0,0.55)" },
      { transform: `translate(${arcMidX - sourceRect.left}px,${arcMidY - sourceRect.top}px) scale(${midScale})`, opacity: 1, boxShadow: "0 16px 48px rgba(0,0,0,0.4)", offset: 0.42 },
      { transform: `translate(${targetLeft - sourceRect.left}px,${targetTop - sourceRect.top}px) scale(${targetScale})`, opacity: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.25)" },
    ],
    { duration: 680, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", fill: "forwards" }
  );

  anim.onfinish = () => clone.remove();
  window.setTimeout(() => clone.remove(), 800);
}

function runAlbumOpenAnimation(albumId) {
  const container = document.getElementById("albums");

  if (!container || albumId === null || albumId === undefined) {
    return;
  }

  const target = Array.from(container.querySelectorAll(".album-card.expanded"))
    .find((element) => String(element.dataset.albumId || "") === String(albumId));

  if (!target) {
    return;
  }

  target.classList.remove("album-opening");

  window.requestAnimationFrame(() => {
    target.classList.add("album-opening");

    const clearAnimationClass = () => {
      target.classList.remove("album-opening");
    };

    target.addEventListener("animationend", clearAnimationClass, { once: true });
    window.setTimeout(clearAnimationClass, 900);
  });
}

function applyNowPlayingDiscVisual(nowPlaying) {
  const primaryDisc = document.getElementById("now-playing-disc");
  const secondaryDisc = document.getElementById("now-playing-disc-secondary");
  const nowPlayingSection = document.getElementById("now-playing");

  if (!primaryDisc || !secondaryDisc || !nowPlayingSection) {
    return;
  }

  const albumMeta = findAlbumByNowPlaying(nowPlaying);
  const discType = albumMeta?.discType === "cd" ? "cd" : "vinyl";
  const primaryColor = String(albumMeta?.vinylColor || "#0b0b0b").trim() || "#0b0b0b";
  const secondaryColor = String(albumMeta?.vinylColorSecondary || "").trim();
  const discCount = Number(albumMeta?.discCount || 1);
  const showSecondDisc = discCount > 1 || Boolean(secondaryColor);
  const reviewScope = nowPlaying?.reviewScope === "album" ? "album" : "song";
  const primarySpeed = reviewScope === "album" ? "3.8s" : "1.9s";
  const secondarySpeed = reviewScope === "album" ? "5.3s" : "2.7s";

  nowPlayingSection.style.setProperty("--np-spin-primary", primarySpeed);
  nowPlayingSection.style.setProperty("--np-spin-secondary", secondarySpeed);

  primaryDisc.style.setProperty("--disc-color", primaryColor);
  secondaryDisc.style.setProperty("--disc-color", secondaryColor || primaryColor);

  primaryDisc.classList.toggle("cd-disc", discType === "cd");
  secondaryDisc.classList.toggle("cd-disc", discType === "cd");

  const clearVinyl = discType === "vinyl" && Boolean(albumMeta?.isClearVinyl);
  primaryDisc.classList.toggle("clear-vinyl", clearVinyl);
  secondaryDisc.classList.toggle("clear-vinyl", clearVinyl);

  secondaryDisc.classList.toggle("visible", showSecondDisc);
}

async function startAlbumListening(album) {
  if (!album || !isAdminUser() || !sessionState.currentUser?.name) {
    return;
  }

  const nowPlaying = await apiSetNowPlaying({
    actorName: sessionState.currentUser.name,
    albumTitle: album.title,
    albumArtist: album.artist,
    songTitle: "",
    reviewScope: "album",
    coverUrl: album.coverUrl
  });
  album.timesPlayed = Number.isFinite(Number(album.timesPlayed)) ? Number(album.timesPlayed) + 1 : 1;
  renderAlbums();
  if (nowPlaying) renderNowPlaying(nowPlaying);
  showReviewStatus(`Escucha iniciada para album: ${album.title}`);
}

async function startSongListening(album, songTitle) {
  if (!album || !songTitle || !isAdminUser() || !sessionState.currentUser?.name) {
    return;
  }

  const nowPlaying = await apiSetNowPlaying({
    actorName: sessionState.currentUser.name,
    albumTitle: album.title,
    albumArtist: album.artist,
    songTitle,
    reviewScope: "song",
    coverUrl: album.coverUrl
  });
  album.timesPlayed = Number.isFinite(Number(album.timesPlayed)) ? Number(album.timesPlayed) + 1 : 1;
  renderAlbums();
  if (nowPlaying) renderNowPlaying(nowPlaying);
  showReviewStatus(`Escucha iniciada: ${album.title} - ${songTitle}`);
}

function closeProfileMenu() {
  const menu = document.getElementById("profile-menu");
  const trigger = document.getElementById("profile-avatar-button");

  if (menu) {
    menu.hidden = true;
  }

  if (trigger) {
    trigger.setAttribute("aria-expanded", "false");
  }
}

function toggleProfileMenu() {
  const menu = document.getElementById("profile-menu");
  const trigger = document.getElementById("profile-avatar-button");

  if (!menu || !trigger) {
    return;
  }

  const shouldOpen = menu.hidden;
  menu.hidden = !shouldOpen;
  trigger.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function showMainView() {
  const mainView = document.getElementById("main-view");
  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");
  const partyRecordsView = document.getElementById("party-records-view");
  const usersBoardView = document.getElementById("users-board-view");
  const myPartiesView = document.getElementById("my-parties-view");

  if (mainView) mainView.hidden = false;
  if (reviewsView) reviewsView.hidden = true;
  if (profileView) profileView.hidden = true;
  if (partyRecordsView) partyRecordsView.hidden = true;
  if (usersBoardView) usersBoardView.hidden = true;
  if (myPartiesView) myPartiesView.hidden = true;
}

function openProfileView() {
  const mainView = document.getElementById("main-view");
  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");
  const partyRecordsView = document.getElementById("party-records-view");
  const usersBoardView = document.getElementById("users-board-view");
  const myPartiesView = document.getElementById("my-parties-view");

  if (mainView) mainView.hidden = true;
  if (reviewsView) reviewsView.hidden = true;
  if (profileView) profileView.hidden = false;
  if (partyRecordsView) partyRecordsView.hidden = true;
  if (usersBoardView) usersBoardView.hidden = true;
  if (myPartiesView) myPartiesView.hidden = true;
  renderProfileAlbums();
}

function renderMyReviews(reviews) {
  const list = document.getElementById("my-reviews-list");

  if (!list) {
    return;
  }

  if (!reviews.length) {
    list.innerHTML = "<li class=\"my-review-item\"><p>No tienes reseñas todavia.</p></li>";
    return;
  }

  list.innerHTML = reviews
    .map((entry) => {
      const scope = entry.scope === "album" ? "Album" : "Cancion";
      const albumTitle = escapeHtml(entry.albumTitle || "Album desconocido");
      const songTitle = escapeHtml(entry.songTitle || "");
      const rating = Number(entry.rating || 0).toFixed(1);
      const text = String(entry.text || "").trim();
      const textMarkup = text ? `<p>${escapeHtml(text)}</p>` : "";
      const createdAt = escapeHtml(formatReviewDate(entry.createdAt || ""));
      const target = entry.scope === "album"
        ? albumTitle
        : `${albumTitle} - ${songTitle || "Cancion"}`;

      return `
        <li class="my-review-item">
          <p class="my-review-meta">${scope}: ${target}</p>
          ${textMarkup}
          <p>${rating} / 5</p>
          <p class="my-review-date">${createdAt}</p>
        </li>
      `;
    })
    .join("");
}

async function apiGetPartyRecords() {
  const response = await fetch(`/api/party-records?t=${Date.now()}`, { cache: "no-store" });
  if (response.status === 403) throw new Error("Solo el administrador puede ver el registro.");
  if (!response.ok) throw new Error("No se pudieron cargar los registros.");
  const payload = await response.json();
  return Array.isArray(payload.parties) ? payload.parties : [];
}

async function apiGetMyParties() {
  const response = await fetch(`/api/my-parties?t=${Date.now()}`, { cache: "no-store" });
  if (response.status === 401) throw new Error("Inicia sesion para ver tus listening partys.");
  if (!response.ok) throw new Error("No se pudieron cargar las listening partys.");
  const payload = await response.json();
  return Array.isArray(payload.parties) ? payload.parties : [];
}

function buildPartyAlbumsMarkup(party) {
  const allReviews = Array.isArray(party.reviews) ? party.reviews : [];

  return (Array.isArray(party.albumsPlayed) ? party.albumsPlayed : []).map((album) => {
    const safeCover = escapeHtml(album.coverUrl || "");
    const safeTitle = escapeHtml(album.title || "");
    const safeArtist = escapeHtml(album.artist || "");

    const albumReviews = allReviews.filter((r) => r.scope === "album" && r.albumTitle === album.title);
    const avgScore = albumReviews.length
      ? (albumReviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / albumReviews.length).toFixed(1)
      : null;
    const reviewers = albumReviews.map((r) => escapeHtml(r.reviewer || "")).filter(Boolean).join(", ");

    const songReviews = allReviews.filter((r) => r.scope === "song" && r.albumTitle === album.title);
    const uniqueSongs = [...new Set(songReviews.map((r) => r.songTitle).filter(Boolean))];

    const songsMarkup = uniqueSongs.length
      ? `<p class="party-section-label">Canciones</p><ul class="my-party-songs-list">${uniqueSongs.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
      : "";

    const scoreMarkup = avgScore
      ? `<p class="party-section-label">Score</p><p class="my-party-score">${avgScore}/5 <span class="my-party-reviewers">(${reviewers})</span></p>`
      : "";

    return `
      <div class="my-party-album-card">
        <div class="my-party-album-header">
          <img src="${safeCover}" alt="${safeTitle}" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" />
          <div>
            <p class="my-party-album-title">${safeTitle}</p>
            <p class="my-party-album-artist">${safeArtist}</p>
          </div>
        </div>
        ${songsMarkup}
        ${scoreMarkup}
      </div>`;
  }).join("");
}

function buildPartyPictureMarkup(party) {
  const partyPicture = String(party?.partyPicture || "").trim();
  if (!partyPicture) {
    return "";
  }

  const safePicture = escapeHtml(partyPicture);
  const safeDate = escapeHtml(formatPartyDate(party?.date || ""));

  return `
    <div class="my-party-picture-wrap">
      <p class="party-section-label">Foto</p>
      <button type="button" class="my-party-picture-button" data-party-picture-src="${safePicture}" aria-label="Abrir foto de la listening party">
        <img src="${safePicture}" alt="Foto de listening party del ${safeDate}" loading="lazy" />
      </button>
    </div>
  `;
}

function openPartyPictureLightbox(imageSrc, altText) {
  const overlay = document.getElementById("party-picture-lightbox");
  const image = document.getElementById("party-picture-lightbox-image");
  if (!overlay || !image || !imageSrc) return;

  image.src = imageSrc;
  image.alt = altText || "Foto de listening party";
  overlay.hidden = false;
}

function closePartyPictureLightbox() {
  const overlay = document.getElementById("party-picture-lightbox");
  const image = document.getElementById("party-picture-lightbox-image");
  if (overlay) overlay.hidden = true;
  if (image) {
    image.removeAttribute("src");
    image.alt = "";
  }
}

function renderMyParties(parties) {
  const list = document.getElementById("my-parties-list");
  if (!list) return;

  if (!parties.length) {
    list.innerHTML = "<p style=\"color:#94a3b8;font-size:0.8rem;margin:0\">No has estado en ninguna listening party todavia.</p>";
    return;
  }

  list.innerHTML = parties.map((party) => {
    const date = escapeHtml(formatPartyDate(party.date || ""));
    const attendees = (Array.isArray(party.attendees) ? party.attendees : [])
      .map((a) => escapeHtml(String(a || "")))
      .join(", ");
    const listeners = (Array.isArray(party.listeners) ? party.listeners : [])
      .map((l) => escapeHtml(String(l || "")))
      .join(", ");
    const albumsMarkup = buildPartyAlbumsMarkup(party);
    const pictureMarkup = buildPartyPictureMarkup(party);

    return `
      <article class="party-record-card">
        <p class="party-record-date">${date}</p>
        <p class="party-section-label">Asistentes</p>
        <p class="party-attendees">${attendees || "—"}</p>
        <p class="party-section-label">Listeners</p>
        <p class="party-attendees">${listeners || "—"}</p>
        ${pictureMarkup}
        <p class="party-section-label">Albums</p>
        ${albumsMarkup || "<p style=\"color:#94a3b8;font-size:0.75rem;margin:0\">—</p>"}
      </article>`;
  }).join("");
}

function setupPartyPictureLightboxInteractions() {
  document.addEventListener("click", (event) => {
    const pictureButton = event.target.closest("[data-party-picture-src]");
    if (pictureButton) {
      const src = String(pictureButton.dataset.partyPictureSrc || "").trim();
      if (!src) return;
      openPartyPictureLightbox(src, "Foto de listening party");
      return;
    }

    const closeButton = event.target.closest("#party-picture-lightbox-close");
    const overlay = event.target.closest("#party-picture-lightbox");
    if (closeButton || overlay === event.target) {
      closePartyPictureLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const overlay = document.getElementById("party-picture-lightbox");
    if (!overlay || overlay.hidden) return;
    closePartyPictureLightbox();
  });
}

function renderPartyRecords(parties) {
  const list = document.getElementById("party-records-list");
  if (!list) return;

  if (!parties.length) {
    list.innerHTML = "<p style=\"color:#94a3b8;font-size:0.8rem;margin:0\">No hay registros todavia. Los registros se guardan mientras la listening party esta activa.</p>";
    return;
  }

  list.innerHTML = parties.map((party) => {
    const date = escapeHtml(formatPartyDate(party.date || ""));
    const attendees = (Array.isArray(party.attendees) ? party.attendees : [])
      .map((a) => escapeHtml(String(a || "")))
      .join(", ");
    const listeners = (Array.isArray(party.listeners) ? party.listeners : [])
      .map((l) => escapeHtml(String(l || "")))
      .join(", ");
    const pictureMarkup = buildPartyPictureMarkup(party);

    const albumsMarkup = (Array.isArray(party.albumsPlayed) ? party.albumsPlayed : [])
      .map((album) => {
        const safeCover = escapeHtml(album.coverUrl || "");
        const safeTitle = escapeHtml(album.title || "");
        const safeArtist = escapeHtml(album.artist || "");
        const label = safeArtist ? `${safeTitle} — ${safeArtist}` : safeTitle;
        return `
          <div class="party-album-item">
            <img src="${safeCover}" alt="${safeTitle}" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" />
            <span title="${label}">${safeTitle}</span>
          </div>`;
      }).join("");

    const reviewsMarkup = (Array.isArray(party.reviews) ? party.reviews : [])
      .map((r) => {
        const reviewer = escapeHtml(r.reviewer || "");
        const albumTitle = escapeHtml(r.albumTitle || "");
        const songTitle = escapeHtml(r.songTitle || "");
        const rating = Number(r.rating || 0).toFixed(1);
        const text = escapeHtml(r.text || "");
        const target = r.scope === "song" && songTitle
          ? `${albumTitle} — ${songTitle}`
          : albumTitle;
        const textMarkup = text ? `<p class="party-review-text">${text}</p>` : "";
        const likes = Array.isArray(r.likes) ? r.likes : [];
        const likersMarkup = likes.length
          ? `<div class="party-review-likers">${likes.map((l) => {
              const safeName = escapeHtml(String(l.name || "?"));
              return l.photoDataUrl
                ? `<img class="party-liker-avatar" src="${escapeHtml(l.photoDataUrl)}" alt="${safeName}" title="${safeName}" loading="lazy" />`
                : `<span class="party-liker-initial" title="${safeName}">${escapeHtml(String(l.name || "?")[0].toUpperCase())}</span>`;
            }).join("")}</div>`
          : "";
        return `
          <li class="party-review-item">
            <p class="party-review-meta">${reviewer} · ${target} · ${rating}/5</p>
            ${textMarkup}
            ${likersMarkup}
          </li>`;
      }).join("");

    const reviewsSection = reviewsMarkup
      ? `<p class="party-section-label">Reseñas</p><ul class="party-reviews-list">${reviewsMarkup}</ul>`
      : "";

    return `
      <article class="party-record-card">
        <p class="party-record-date">${date}</p>
        <p class="party-section-label">Asistentes</p>
        <p class="party-attendees">${attendees || "—"}</p>
        <p class="party-section-label">Listeners</p>
        <p class="party-attendees">${listeners || "—"}</p>
        ${pictureMarkup}
        <p class="party-section-label">Albums</p>
        <div class="party-albums-grid">${albumsMarkup || "<p style=\"color:#94a3b8;font-size:0.75rem;margin:0\">—</p>"}</div>
        ${reviewsSection}
      </article>`;
  }).join("");
}

function formatPartyDate(dateStr) {
  if (!dateStr) return "Fecha desconocida";
  const hasTime = dateStr.includes("T");
  const value = hasTime ? new Date(dateStr) : new Date(dateStr + "T12:00:00");
  if (Number.isNaN(value.getTime())) return dateStr;
  if (hasTime) {
    return value.toLocaleString([], { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return value.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

async function openPartyRecordsView() {
  if (!isAdminUser()) return;

  const mainView = document.getElementById("main-view");
  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");
  const partyRecordsView = document.getElementById("party-records-view");
  const myPartiesView = document.getElementById("my-parties-view");

  if (mainView) mainView.hidden = true;
  if (reviewsView) reviewsView.hidden = true;
  if (profileView) profileView.hidden = true;
  if (partyRecordsView) partyRecordsView.hidden = false;
  if (myPartiesView) myPartiesView.hidden = true;

  const list = document.getElementById("party-records-list");
  if (list) list.innerHTML = "<p style=\"color:#94a3b8;font-size:0.8rem;margin:0\">Cargando...</p>";

  try {
    const parties = await apiGetPartyRecords();
    renderPartyRecords(parties);
  } catch (error) {
    if (list) list.innerHTML = `<p style="color:#ef4444;font-size:0.8rem;margin:0">${escapeHtml(error instanceof Error ? error.message : "Error")}</p>`;
  }
}

async function openMyPartiesView() {
  if (!sessionState.currentUser?.name) {
    showAuthOverlay("Inicia sesion para ver tus listening partys.");
    return;
  }

  const mainView = document.getElementById("main-view");
  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");
  const partyRecordsView = document.getElementById("party-records-view");
  const usersBoardView = document.getElementById("users-board-view");
  const myPartiesView = document.getElementById("my-parties-view");

  if (mainView) mainView.hidden = true;
  if (reviewsView) reviewsView.hidden = true;
  if (profileView) profileView.hidden = true;
  if (partyRecordsView) partyRecordsView.hidden = true;
  if (usersBoardView) usersBoardView.hidden = true;
  if (myPartiesView) myPartiesView.hidden = false;

  const list = document.getElementById("my-parties-list");
  if (list) list.innerHTML = "<p style=\"color:#94a3b8;font-size:0.8rem;margin:0\">Cargando...</p>";

  try {
    const parties = await apiGetMyParties();
    renderMyParties(parties);
  } catch (error) {
    if (list) list.innerHTML = `<p style="color:#ef4444;font-size:0.8rem;margin:0">${escapeHtml(error instanceof Error ? error.message : "Error")}</p>`;
  }
}

let partyBriefShownId = null;

function showPartyBriefPopup(party) {
  const popup = document.getElementById("party-brief-popup");
  const dateEl = document.getElementById("party-brief-date");
  const contentEl = document.getElementById("party-brief-content");
  if (!popup || !dateEl || !contentEl) return;

  dateEl.textContent = formatPartyDate(party.date || "");

  const attendees = (Array.isArray(party.attendees) ? party.attendees : [])
    .map((a) => escapeHtml(String(a || "")))
    .join(", ");
  const listeners = (Array.isArray(party.listeners) ? party.listeners : [])
    .map((l) => escapeHtml(String(l || "")))
    .join(", ");

  const albumsMarkup = buildPartyAlbumsMarkup(party);

  contentEl.innerHTML = `
    <p class="party-section-label">Asistentes</p>
    <p class="party-attendees">${attendees || "—"}</p>
    <p class="party-section-label">Listeners</p>
    <p class="party-attendees">${listeners || "—"}</p>
    <p class="party-section-label">Albums</p>
    ${albumsMarkup || "<p style=\"color:#94a3b8;font-size:0.75rem;margin:0\">—</p>"}
  `;

  popup.hidden = false;
}

function hidePartyBriefPopup() {
  const popup = document.getElementById("party-brief-popup");
  if (popup) popup.hidden = true;
}

async function handlePartyJustEnded() {
  if (!sessionState.currentUser) return;
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    const parties = await apiGetMyParties();
    if (!parties.length) return;
    const latest = parties[0];
    if (latest.id && latest.id !== partyBriefShownId) {
      partyBriefShownId = latest.id;
      showPartyBriefPopup(latest);
    }
  } catch {
    // ignore
  }
}

async function apiGetLiveAlbums() {
  const res = await fetch(`/api/live-albums?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.albums) ? data.albums : [];
}

async function apiAddLiveAlbum(album) {
  const res = await fetch("/api/live-albums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(album)
  });
  if (!res.ok) throw new Error("No se pudo guardar el album.");
  return res.json();
}

async function apiGetUsersBoard() {
  const res = await fetch("/api/admin/users");
  if (res.status === 403) throw new Error("Solo el administrador puede ver esto.");
  if (!res.ok) throw new Error("No se pudo cargar la lista de usuarios.");
  const data = await res.json();
  return Array.isArray(data.users) ? data.users : [];
}

function renderUsersBoard(users) {
  const list = document.getElementById("users-board-list");
  if (!list) return;

  if (!users.length) {
    list.innerHTML = "<p style=\"color:#94a3b8;font-size:0.8rem;margin:0\">No hay usuarios registrados.</p>";
    return;
  }

  list.innerHTML = users.map((user) => {
    const safeName = escapeHtml(String(user.name || ""));
    const safeAccount = escapeHtml(String(user.accountName || ""));
    const safePassword = escapeHtml(String(user.password || "—"));
    const photoUrl = String(user.photoDataUrl || "").trim();
    const avatarMarkup = photoUrl
      ? `<img class="user-board-avatar" src="${escapeHtml(photoUrl)}" alt="Foto de ${safeName}" />`
      : `<div class="user-board-avatar-placeholder">?</div>`;

    const reviews = Array.isArray(user.reviews) ? user.reviews : [];
    const reviewsMarkup = reviews.length
      ? reviews.map((r) => {
          const safeTitle = escapeHtml(String(r.albumTitle || r.songTitle || ""));
          const safeSong = r.scope === "song" ? escapeHtml(String(r.songTitle || "")) : "";
          const safeRating = Number(r.rating || 0).toFixed(1);
          const safeText = escapeHtml(String(r.text || "").trim());
          const meta = safeSong ? `${safeTitle} — ${safeSong} · ${safeRating}/5` : `${safeTitle} · ${safeRating}/5`;
          return `
            <li class="user-board-review-item">
              <p class="user-board-review-meta">${meta}</p>
              ${safeText ? `<p class="user-board-review-text">${safeText}</p>` : ""}
            </li>`;
        }).join("")
      : `<li class="user-board-no-reviews">Sin reseñas.</li>`;

    const reviewCount = reviews.length;
    const reviewsId = `user-reviews-${escapeHtml(safeAccount || safeName).replace(/\s+/g, "-")}`;

    return `
      <div class="user-board-card">
        <div class="user-board-header">
          ${avatarMarkup}
          <div class="user-board-info">
            <p class="user-board-name">${safeName}</p>
            <p class="user-board-account">${safeAccount}</p>
          </div>
        </div>
        <div class="user-board-password-row">
          <span class="user-board-password-label">Contraseña</span>
          <button class="user-board-password-reveal" data-password="${safePassword}" aria-label="Mostrar contraseña">
            <span class="user-board-password-value">••••••</span>
          </button>
        </div>
        <button class="user-board-reviews-toggle" aria-expanded="false" data-reviews-target="${reviewsId}">
          Reseñas <span class="user-board-reviews-count">${reviewCount}</span>
        </button>
        <ul id="${reviewsId}" class="user-board-reviews-list" hidden>${reviewsMarkup}</ul>
      </div>`;
  }).join("");

  list.querySelectorAll(".user-board-reviews-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-reviews-target");
      const ul = document.getElementById(targetId);
      if (!ul) return;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
      ul.hidden = expanded;
    });
  });

  list.querySelectorAll(".user-board-password-reveal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const valueEl = btn.querySelector(".user-board-password-value");
      const revealed = btn.dataset.revealed === "true";
      if (revealed) {
        valueEl.textContent = "••••••";
        btn.dataset.revealed = "false";
        btn.setAttribute("aria-label", "Mostrar contraseña");
      } else {
        valueEl.textContent = btn.dataset.password;
        btn.dataset.revealed = "true";
        btn.setAttribute("aria-label", "Ocultar contraseña");
      }
    });
  });
}

async function openUsersBoardView() {
  if (!isAdminUser()) return;

  const mainView = document.getElementById("main-view");
  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");
  const partyRecordsView = document.getElementById("party-records-view");
  const usersBoardView = document.getElementById("users-board-view");
  const myPartiesView = document.getElementById("my-parties-view");

  if (mainView) mainView.hidden = true;
  if (reviewsView) reviewsView.hidden = true;
  if (profileView) profileView.hidden = true;
  if (partyRecordsView) partyRecordsView.hidden = true;
  if (myPartiesView) myPartiesView.hidden = true;
  if (usersBoardView) usersBoardView.hidden = false;

  const list = document.getElementById("users-board-list");
  if (list) list.innerHTML = "<p style=\"color:#94a3b8;font-size:0.8rem;margin:0\">Cargando...</p>";

  try {
    const users = await apiGetUsersBoard();
    renderUsersBoard(users);
  } catch (error) {
    if (list) list.innerHTML = `<p style="color:#ef4444;font-size:0.8rem;margin:0">${escapeHtml(error instanceof Error ? error.message : "Error")}</p>`;
  }
}

async function openMyReviewsView() {
  if (!sessionState.currentUser?.name) {
    showAuthOverlay("Inicia sesion para ver tus reseñas.");
    return;
  }

  try {
    const reviews = await apiGetMyReviews(sessionState.currentUser.name);
    renderMyReviews(reviews);

    const mainView = document.getElementById("main-view");
    const reviewsView = document.getElementById("reviews-view");
    const profileView = document.getElementById("profile-view");
    const myPartiesView = document.getElementById("my-parties-view");

    viewBeforeReviews = profileView && !profileView.hidden ? "profile" : "main";

    if (mainView) mainView.hidden = true;
    if (profileView) profileView.hidden = true;
    if (myPartiesView) myPartiesView.hidden = true;
    if (reviewsView) reviewsView.hidden = false;
  } catch (error) {
    showReviewStatus(error instanceof Error ? error.message : "No se pudieron cargar tus reseñas.");
  }
}

async function logoutUser() {
  try {
    await apiLogout();
  } catch {
    // Ignore logout API failures and clear local state anyway.
  }

  sessionState.currentUser = null;
  setCurrentUser(null);
  closeProfileMenu();
  showMainView();
  closeReviewPanel();
  showAuthOverlay("Sesion cerrada.");
}

function buildAlbumCardHtml(album) {
  const adminUser = isAdminUser();
  const isExpanded = appState.expandedAlbumId === album.id;
  const safeTitle = escapeHtml(album.title);
  const safeArtist = escapeHtml(album.artist);
  const safeYear = escapeHtml(album.year);
  const safeTimesPlayed = escapeHtml(String(Number(album.timesPlayed || 0)));
  const safeGenre = escapeHtml(album.genre);
  const safeNotes = escapeHtml(album.notes);
  const safeGiftedBy = escapeHtml(album.giftedBy || "");
  const safeOwner = escapeHtml(album.owner || "");
  const safeCoverUrl = escapeHtml(album.coverUrl);
  const safeVinylColor = escapeHtml(album.vinylColor || "#0b0b0b");
  const safeVinylColorSecondary = escapeHtml(album.vinylColorSecondary || "");
  const secondaryVinylColor = safeVinylColorSecondary || safeVinylColor;
  const isCdDisc = album.discType === "cd";
  const hasBothFormats = album.discType === "both";
  const hasSecondDisc = !isCdDisc && (hasBothFormats || Boolean(safeVinylColorSecondary) || Number(album.discCount || 1) > 1);
  const clearVinylClass = album.isClearVinyl ? "clear-vinyl" : "";
  const coverClassName = album.ownedByUser ? "" : "not-owned";
  const detailListMarkup = adminUser
    ? (album.tracks || [])
        .map((track, index) => {
          const safeTrack = escapeHtml(track);
          return `<li><button type="button" class="track-play-button" data-album-id="${escapeHtml(String(album.id))}" data-track-index="${index}">${safeTrack}</button></li>`;
        })
        .join("")
    : (album.details || [])
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("");
  const listenAlbumMarkup = adminUser
    ? `<button type="button" class="album-action-button listen-album-button" data-album-id="${escapeHtml(String(album.id))}">Escuchar album</button>`
    : "";
  const spotifyButtonMarkup = album.spotifyUrl
    ? `<a class="album-action-button" href="${escapeHtml(album.spotifyUrl)}" target="_blank" rel="noreferrer">Abrir en Spotify</a>`
    : "";
  const linksMarkup = (spotifyButtonMarkup || listenAlbumMarkup)
    ? `<div class="album-links">${listenAlbumMarkup}${spotifyButtonMarkup}</div>`
    : "";
  const giftedByMarkup = safeGiftedBy
    ? `<p class="gifted-by"><em>Regalado por: ${safeGiftedBy}</em></p>`
    : "";
  const ownerMarkup = safeOwner
    ? `<p class="album-owner">De: ${safeOwner}</p>`
    : "";

  const ownerPhotoUrl = String(album.ownerPhotoUrl || "").trim();
  const ownerBadgeMarkup = album.isLive && safeOwner
    ? ownerPhotoUrl
      ? `<span class="album-owner-badge" title="${safeOwner}"><img src="${escapeHtml(ownerPhotoUrl)}" alt="${safeOwner}" /></span>`
      : `<span class="album-owner-badge album-owner-badge--letter" title="${safeOwner}">${escapeHtml(safeOwner[0]?.toUpperCase() || "?")}</span>`
    : "";

  return `
        <article class="album-card ${isExpanded ? "expanded" : ""}" data-album-id="${escapeHtml(String(album.id))}">
          <button
            type="button"
            class="cover-button"
            data-album-id="${album.id}"
            aria-expanded="${isExpanded}"
            aria-controls="album-details-${album.id}"
          >
            <img class="${coverClassName}" src="${safeCoverUrl}" alt="${safeTitle} album cover" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" />
            <span class="vinyl-overlay ${isCdDisc ? "cd-overlay" : ""}" aria-hidden="true">
              <span class="vinyl-disc vinyl-disc-primary ${isCdDisc ? "cd-disc" : ""} ${clearVinylClass}" style="--vinyl-color:${safeVinylColor}"></span>
              ${hasSecondDisc ? `<span class="vinyl-disc vinyl-disc-secondary ${hasBothFormats ? "cd-disc cd-disc-secondary" : clearVinylClass}" style="--vinyl-color:${secondaryVinylColor}"></span>` : ""}
            </span>
            ${ownerBadgeMarkup}
          </button>
          <div id="album-details-${album.id}" class="album-details">
            <h2>${safeTitle}</h2>
            <p class="meta">${safeArtist} - ${safeYear}</p>
            <p class="meta">Reproducido ${safeTimesPlayed} veces</p>
            <p class="meta">${safeGenre}</p>
            <p class="notes">${safeNotes}</p>
            ${ownerMarkup}
            ${giftedByMarkup}
            ${linksMarkup}
            <ol class="track-list">${detailListMarkup}</ol>
          </div>
        </article>
      `;
}

function getGroupedAlbums() {
  const sorted = getSortedAlbums();
  // For owner grouping, include all albums (main + live); otherwise only main albums
  const source = appState.groupBy === "owner"
    ? sorted
    : sorted.filter(a => !a.isLive);
  const groups = new Map();
  for (const album of source) {
    let key;
    if (appState.groupBy === "genre") {
      key = album.primaryGenre || "Sin género";
    } else if (appState.groupBy === "owner") {
      key = album.isLive && album.owner ? album.owner : "Iñaki";
    } else {
      key = album.artist || "Unknown";
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(album);
  }
  // Put "Iñaki" first in owner grouping, then alphabetical
  const entries = Array.from(groups.entries());
  if (appState.groupBy === "owner") {
    entries.sort(([a], [b]) => {
      if (a === "Iñaki") return -1;
      if (b === "Iñaki") return 1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  } else {
    entries.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }
  return entries.map(([key, albums]) => ({ key, albums }));
}

function buildGroupedAlbumsHtml() {
  const groups = getGroupedAlbums();
  if (!groups.length) return "";

  return groups.map(({ key, albums }) => {
    const isExpanded = appState.expandedGroupKey === key;
    const safeKey = escapeHtml(key);
    const dataKey = escapeHtml(key);

    if (isExpanded) {
      const innerCards = albums.map(buildAlbumCardHtml).join("");
      return `
        <div class="group-expanded" data-group-key="${dataKey}">
          <button type="button" class="group-expanded-heading" data-group-key="${dataKey}">← ${safeKey}</button>
          <div class="group-inner-grid">${innerCards}</div>
        </div>
      `;
    }

    const pileAlbums = albums.slice(0, 3);
    const pileOffset = 3 - pileAlbums.length;
    const coversMarkup = pileAlbums.map((album, i) => {
      const safeCover = escapeHtml(album.coverUrl);
      const safeTitle = escapeHtml(album.title);
      return `<span class="pile-cover pile-cover-${i + pileOffset}"><img src="${safeCover}" alt="${safeTitle}" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" /></span>`;
    }).join("");
    const countBadge = albums.length > 1
      ? `<span class="pile-count">${albums.length}</span>`
      : "";

    return `
      <div class="group-pile" data-group-key="${dataKey}">
        <p class="group-pile-name">${safeKey}</p>
        <button type="button" class="group-pile-covers" data-group-key="${dataKey}" aria-label="Expandir ${safeKey}">
          ${coversMarkup}
          ${countBadge}
        </button>
      </div>
    `;
  }).join("");
}

function animateGroupPilesIn(container) {
  const piles = container.querySelectorAll(".group-pile");
  piles.forEach((pile, i) => {
    pile.style.setProperty("--pile-in-delay", `${i * 40}ms`);
    pile.classList.add("pile-entering");
    pile.addEventListener("animationend", () => pile.classList.remove("pile-entering"), { once: true });
  });
}

function updateAlbumCountBadge() {
  const badge = document.getElementById("album-count");
  if (!badge) return;
  const count = appState.albums.length;
  badge.textContent = count > 0 ? String(count) : "";
}

function renderAlbums() {
  const container = document.getElementById("albums");
  const invitedSection = document.getElementById("invited-music-section");
  const invitedContainer = document.getElementById("invited-albums");

  if (!container) {
    return;
  }

  updateAlbumCountBadge();

  if (!appState.albums.length) {
    container.innerHTML = "";
    if (invitedSection) invitedSection.hidden = true;
    return;
  }

  if (appState.groupBy) {
    // In group mode all albums (including live) render in the main container
    container.innerHTML = buildGroupedAlbumsHtml();
    animateGroupPilesIn(container);
    if (invitedSection) invitedSection.hidden = true;
    return;
  }

  // Default: main Discogs collection up top, invited (live) albums in their own section
  const mainAlbums = appState.albums.filter(a => !a.isLive);
  const invitedAlbums = appState.albums.filter(a => a.isLive);

  container.innerHTML = mainAlbums.map(buildAlbumCardHtml).join("");

  if (invitedAlbums.length && invitedSection && invitedContainer) {
    invitedContainer.innerHTML = invitedAlbums.map(buildAlbumCardHtml).join("");
    invitedSection.hidden = false;
  } else if (invitedSection) {
    invitedSection.hidden = true;
  }
}

function updateSortDirectionButtonLabel() {
  const directionButton = document.getElementById("album-sort-direction");
  if (!directionButton) {
    return;
  }

  directionButton.textContent = appState.sortDirection === "asc" ? "↑" : "↓";
}

function setupAlbumSortControls() {
  const sortBySelect = document.getElementById("album-sort-by");
  const directionButton = document.getElementById("album-sort-direction");
  const shuffleButton = document.getElementById("album-shuffle");

  if (!sortBySelect || !directionButton) {
    return;
  }

  sortBySelect.value = appState.sortBy;
  updateSortDirectionButtonLabel();

  const applySortBySelection = () => {
    const selected = String(sortBySelect.value || "date");
    appState.sortBy = ["date", "score", "timesPlayed", "title", "artist", "genre"].includes(selected) ? selected : "date";
    sortAlbumsInState();
    renderAlbums();
  };

  sortBySelect.addEventListener("change", applySortBySelection);
  sortBySelect.addEventListener("input", applySortBySelection);

  directionButton.addEventListener("click", () => {
    appState.sortDirection = appState.sortDirection === "asc" ? "desc" : "asc";
    updateSortDirectionButtonLabel();
    sortAlbumsInState();
    renderAlbums();
  });

  if (shuffleButton) {
    shuffleButton.addEventListener("click", () => {
      if (!appState.albums.length) {
        return;
      }

      const randomIndex = Math.floor(Math.random() * appState.albums.length);
      const randomAlbum = appState.albums[randomIndex] || null;
      openAlbumInGrid(randomAlbum, true);
    });
  }

  const groupByArtistButton = document.getElementById("group-by-artist");
  const groupByGenreButton = document.getElementById("group-by-genre");
  const groupByOwnerButton = document.getElementById("group-by-owner");

  if (groupByArtistButton) {
    groupByArtistButton.addEventListener("click", () => {
      appState.groupBy = appState.groupBy === "artist" ? null : "artist";
      appState.expandedGroupKey = null;
      appState.expandedAlbumId = null;
      updateGroupByButtonStates();
      renderAlbums();
    });
  }

  if (groupByGenreButton) {
    groupByGenreButton.addEventListener("click", () => {
      appState.groupBy = appState.groupBy === "genre" ? null : "genre";
      appState.expandedGroupKey = null;
      appState.expandedAlbumId = null;
      updateGroupByButtonStates();
      renderAlbums();
    });
  }

  if (groupByOwnerButton) {
    groupByOwnerButton.addEventListener("click", () => {
      appState.groupBy = appState.groupBy === "owner" ? null : "owner";
      appState.expandedGroupKey = null;
      appState.expandedAlbumId = null;
      updateGroupByButtonStates();
      renderAlbums();
    });
  }

  updateGroupByButtonStates();
}

function getAlbumSearchMatches(query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const startsWith = [];
  const includes = [];

  for (const album of appState.albums) {
    const title = String(album?.title || "").trim();
    const artist = String(album?.artist || "").trim();
    const titleLower = title.toLowerCase();
    const artistLower = artist.toLowerCase();

    const titleStarts = titleLower.startsWith(normalizedQuery);
    const artistStarts = artistLower.startsWith(normalizedQuery);
    const titleIncludes = titleLower.includes(normalizedQuery);
    const artistIncludes = artistLower.includes(normalizedQuery);

    if (!titleIncludes && !artistIncludes) {
      continue;
    }

    const item = { album, title, artist };
    if (titleStarts || artistStarts) {
      startsWith.push(item);
    } else {
      includes.push(item);
    }
  }

  const sorter = (a, b) => {
    const titleCmp = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" });
  };

  startsWith.sort(sorter);
  includes.sort(sorter);
  return [...startsWith, ...includes].slice(0, 8);
}

function setupAlbumSearchBar() {
  const input = document.getElementById("album-search-input");
  const suggestions = document.getElementById("album-search-suggestions");
  if (!input || !suggestions) {
    return;
  }

  const hideSuggestions = () => {
    suggestions.innerHTML = "";
    suggestions.hidden = true;
  };

  const renderSuggestions = (matches) => {
    if (!matches.length) {
      hideSuggestions();
      return;
    }

    suggestions.innerHTML = matches.map(({ album, title, artist }) => {
      const label = artist ? `${title} - ${artist}` : title;
      return `
        <li>
          <button type="button" data-album-id="${escapeHtml(String(album.id))}" title="${escapeHtml(label)}">
            <span class="album-search-suggestion-title">${escapeHtml(title)}</span>
            <span class="album-search-suggestion-artist">${escapeHtml(artist || "")}</span>
          </button>
        </li>
      `;
    }).join("");
    suggestions.hidden = false;
  };

  input.addEventListener("input", () => {
    const matches = getAlbumSearchMatches(input.value);
    renderSuggestions(matches);
  });

  input.addEventListener("focus", () => {
    const matches = getAlbumSearchMatches(input.value);
    renderSuggestions(matches);
  });

  suggestions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-album-id]");
    if (!button) {
      return;
    }

    const album = getAlbumById(button.dataset.albumId || "");
    if (!album) {
      return;
    }

    input.value = `${album.title || ""}${album.artist ? ` - ${album.artist}` : ""}`;
    hideSuggestions();
    openAlbumInGrid(album, true);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (input.contains(target) || suggestions.contains(target)) {
      return;
    }
    hideSuggestions();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSuggestions();
      input.blur();
    }
  });
}

function animateGroupExpand(container, pileRect) {
  const innerGrid = container.querySelector(".group-inner-grid");
  if (!innerGrid) return;

  const cards = Array.from(innerGrid.querySelectorAll(".album-card"));
  if (!cards.length) return;

  const pileCenterX = pileRect.left + pileRect.width / 2;
  const pileCenterY = pileRect.top + pileRect.height / 2;

  cards.forEach((card, index) => {
    const cardRect = card.getBoundingClientRect();
    const dx = pileCenterX - (cardRect.left + cardRect.width / 2);
    const dy = pileCenterY - (cardRect.top + cardRect.height / 2);

    card.style.setProperty("--pile-dx", `${dx}px`);
    card.style.setProperty("--pile-dy", `${dy}px`);
    card.style.setProperty("--pile-delay", `${index * 30}ms`);
    card.classList.add("from-pile");

    card.addEventListener("animationend", () => {
      card.classList.remove("from-pile");
      card.style.removeProperty("--pile-dx");
      card.style.removeProperty("--pile-dy");
      card.style.removeProperty("--pile-delay");
    }, { once: true });
  });
}

function setupAlbumInteractions() {
  const container = document.getElementById("albums");

  if (!container) {
    return;
  }

  container.addEventListener("click", async (event) => {
    const listenAlbumButton = event.target.closest(".listen-album-button");
    if (listenAlbumButton) {
      if (!isAdminUser()) {
        return;
      }

      const album = getAlbumById(listenAlbumButton.dataset.albumId || "");
      if (!album) {
        return;
      }

      const confirmed = window.confirm(`Quieres iniciar currently listening de este album?\n${album.title}`);
      if (!confirmed) {
        return;
      }

      const sourceImg = container.querySelector(".album-card.expanded .cover-button img");
      animateCoverToNowPlaying(sourceImg);

      try {
        await startAlbumListening(album);
      } catch (error) {
        showReviewStatus(error instanceof Error ? error.message : "No se pudo iniciar la escucha del album.");
      }
      return;
    }

    const trackPlayButton = event.target.closest(".track-play-button");
    if (trackPlayButton) {
      if (!isAdminUser()) {
        return;
      }

      const album = getAlbumById(trackPlayButton.dataset.albumId || "");
      const trackIndex = Number(trackPlayButton.dataset.trackIndex || "-1");
      const songTitle = album?.tracks?.[trackIndex] || "";

      if (!album || !songTitle) {
        return;
      }

      const confirmed = window.confirm(`Quieres iniciar currently listening de esta cancion?\n${album.title} - ${songTitle}`);
      if (!confirmed) {
        return;
      }

      const sourceImgTrack = container.querySelector(".album-card.expanded .cover-button img");
      animateCoverToNowPlaying(sourceImgTrack);

      try {
        await startSongListening(album, songTitle);
      } catch (error) {
        showReviewStatus(error instanceof Error ? error.message : "No se pudo iniciar la escucha de la cancion.");
      }
      return;
    }

    const pileButton = event.target.closest(".group-pile-covers");
    if (pileButton) {
      const key = pileButton.dataset.groupKey || "";
      const pileRect = pileButton.getBoundingClientRect();
      appState.expandedGroupKey = key;
      appState.expandedAlbumId = null;
      renderAlbums();
      animateGroupExpand(container, pileRect);
      const expandedGroup = container.querySelector(".group-expanded");
      if (expandedGroup && typeof expandedGroup.scrollIntoView === "function") {
        expandedGroup.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return;
    }

    const groupHeading = event.target.closest(".group-expanded-heading");
    if (groupHeading) {
      appState.expandedGroupKey = null;
      appState.expandedAlbumId = null;
      renderAlbums();
      return;
    }

    const trigger = event.target.closest(".cover-button");

    if (!trigger) {
      return;
    }

    const albumId = trigger.dataset.albumId;
    const isClosing = appState.expandedAlbumId === albumId;

    if (isClosing) {
      const expandedCard = container.querySelector(".album-card.expanded");
      if (expandedCard) {
        expandedCard.classList.add("album-closing");
        expandedCard.classList.remove("expanded");
        window.setTimeout(() => {
          appState.expandedAlbumId = null;
          renderAlbums();
        }, 260);
      } else {
        appState.expandedAlbumId = null;
        renderAlbums();
      }
      return;
    }

    const nextExpandedAlbumId = albumId;
    pendingAlbumOpenAnimationId = nextExpandedAlbumId;
    appState.expandedAlbumId = nextExpandedAlbumId;
    renderAlbums();

    if (pendingAlbumOpenAnimationId) {
      runAlbumOpenAnimation(pendingAlbumOpenAnimationId);
      pendingAlbumOpenAnimationId = null;
    }

    const expandedCard = container.querySelector(".album-card.expanded");
    if (expandedCard && typeof expandedCard.scrollIntoView === "function") {
      expandedCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }
  });
}

async function loadAlbums() {
  const response = await fetch(`./discogs-collection.json?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar discogs-collection.json");
  }

  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];

  return items.map((item, index) => {
    const tracks = Array.isArray(item.tracks)
      ? item.tracks
          .map((track) => normalizeTrackLabel(track))
          .filter((track) => track)
      : [];
    const details = tracks.length
      ? tracks
      : [
          `Pagina de origen: ${item.sourcePage || "?"}`,
          `Artista en Discogs: ${item.artistUrl ? "Disponible" : "n/a"}`,
          item.imageUrl ? "Portada desde Discogs" : "Sin portada",
          `Registro: ${item.rawText ? item.rawText.slice(0, 120) : ""}`
        ].filter(Boolean);

    const spotifyQuery = [item.artist, item.title]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
    const spotifyUrl = spotifyQuery
      ? `https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}`
      : "";

    const giftedBy = String(
      item.regaladoPor || item["regalado por"] || item.regalado_por || item.giftedBy || ""
    ).trim();
    const descriptor = [
      item.rawText,
      item.notes,
      item.format,
      item.formats
    ].filter(Boolean).join(" ");
    const [vinylColor, vinylColorSecondary] = detectVinylColors(descriptor);
    const discType = detectDiscType(descriptor);
    const discCount = detectDiscCount(descriptor);
    const isClearVinyl = detectClearVinyl(descriptor);

    return {
      id: item.releaseUrl || `${item.title}-${item.artist}-${index}`,
      title: item.title || "Untitled release",
      artist: item.artist || "Unknown artist",
      year: item.year || "Unknown year",
      timesPlayed: Number.isFinite(Number(item.timesPlayed)) ? Number(item.timesPlayed) : 0,
      dateAdded: item.dateAdded || "",
      score: Number(item.rating || 0),
      genre: item.rawText || "Discogs collection item",
      primaryGenre: extractPrimaryGenre(item.rawText || ""),
      notes: tracks.length ? `${tracks.length} canciones` : `Release page ${item.sourcePage || "?"}`,
      releaseUrl: item.releaseUrl || "",
      spotifyUrl,
      coverUrl: item.imageUrl || coverFallbackUrl,
      vinylColor,
      vinylColorSecondary,
      discType,
      discCount,
      isClearVinyl,
      tracks,
      details,
      ownedByUser: item.isOwned !== false,
      giftedBy
    };
  });
}

function renderProfileAlbums() {
  const section = document.getElementById("profile-albums-section");
  const grid = document.getElementById("profile-albums-grid");
  if (!section || !grid) return;

  const userName = String(sessionState.currentUser?.name || "").trim().toLowerCase();
  if (!userName) {
    section.hidden = true;
    return;
  }

  const owned = appState.albums.filter(
    (a) => String(a.owner || "").trim().toLowerCase() === userName
  );

  if (!owned.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  grid.innerHTML = owned.map((album) => {
    const safeTitle = escapeHtml(album.title);
    const safeArtist = escapeHtml(album.artist);
    const safeCover = escapeHtml(album.coverUrl);
    return `
      <div class="profile-album-chip">
        <img src="${safeCover}" alt="${safeTitle}" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" />
        <div class="profile-album-chip-info">
          <span class="profile-album-chip-title">${safeTitle}</span>
          <span class="profile-album-chip-artist">${safeArtist}</span>
        </div>
      </div>`;
  }).join("");
}

function buildAlbumFromLive(live) {
  const spotifyQuery = [live.artist, live.title].filter(Boolean).join(" ");
  return {
    id: live.id,
    title: live.title || "Untitled",
    artist: live.artist || "",
    year: new Date(live.addedAt || Date.now()).getFullYear().toString(),
    dateAdded: live.addedAt || new Date().toISOString(),
    score: 0,
    genre: "",
    primaryGenre: "Unknown",
    notes: "",
    releaseUrl: "",
    spotifyUrl: live.spotifyUrl || (spotifyQuery ? `https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}` : ""),
    coverUrl: live.coverUrl || coverFallbackUrl,
    vinylColor: "#0b0b0b",
    vinylColorSecondary: "",
    discType: "vinyl",
    discCount: 1,
    isClearVinyl: false,
    tracks: [],
    details: [],
    ownedByUser: true,
    giftedBy: "",
    owner: live.owner || "",
    ownerPhotoUrl: live.ownerPhotoUrl || "",
    isLive: true
  };
}

function mergeLiveAlbums(liveAlbums) {
  let changed = false;
  for (const live of liveAlbums) {
    if (!live.id || appState.albums.some((a) => a.id === live.id)) continue;
    appState.albums.unshift(buildAlbumFromLive(live));
    changed = true;
  }
  return changed;
}

function startLiveAlbumsPolling() {
  setInterval(async () => {
    try {
      const liveAlbums = await apiGetLiveAlbums();
      if (mergeLiveAlbums(liveAlbums)) {
        renderAlbums();
        renderProfileAlbums();
      }
    } catch {
      // ignore
    }
  }, 5000);
}

function hideNowPlaying() {
  const section = document.getElementById("now-playing");
  const panel = document.getElementById("review-panel");
  const toggle = document.getElementById("now-playing-toggle");
  const stopControls = document.getElementById("now-playing-controls");

  if (panel) {
    panel.hidden = true;
  }

  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
  }

  if (section) {
    section.hidden = true;
  }

  if (stopControls) {
    stopControls.hidden = true;
  }

  currentNowPlaying = null;
  renderReviewBubbles([], "");
  document.documentElement.style.setProperty("--layout-top-space", "0rem");
}

function getSongKey(nowPlaying) {
  if (!nowPlaying || !nowPlaying.albumTitle || !nowPlaying.songTitle) {
    return "";
  }

  return `${nowPlaying.albumTitle}::${nowPlaying.songTitle}`;
}

function getAlbumReviewKey(nowPlaying) {
  if (!nowPlaying || !nowPlaying.albumTitle) {
    return "";
  }

  const parts = [nowPlaying.albumArtist, nowPlaying.albumTitle]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!parts.length) {
    return "";
  }

  return `album::${parts.join("::")}`;
}

function getActiveReviewKey(nowPlaying) {
  if (!nowPlaying) {
    return "";
  }

  if (nowPlaying.reviewScope === "album") {
    return getAlbumReviewKey(nowPlaying);
  }

  return getSongKey(nowPlaying);
}

async function fetchReviewsFromApi(reviewKey) {
  if (!reviewKey) {
    return [];
  }

  const partyId = currentNowPlaying?.partyId;
  const partyParam = partyId ? `&partyId=${encodeURIComponent(partyId)}` : "";
  const response = await fetch(`/api/reviews?songKey=${encodeURIComponent(reviewKey)}${partyParam}&t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not load reviews");
  }

  const payload = await response.json();
  return Array.isArray(payload.reviews) ? payload.reviews : [];
}

async function fetchReviewsFromFile(reviewKey) {
  if (!reviewKey) {
    return [];
  }

  const response = await fetch(`./reviews-db.json?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not load reviews-db.json");
  }

  const payload = await response.json();

  if (!payload || typeof payload !== "object") {
    return [];
  }

  return Array.isArray(payload[reviewKey]) ? payload[reviewKey] : [];
}

async function fetchReviewsForKey(reviewKey) {
  try {
    const reviews = await fetchReviewsFromApi(reviewKey);
    return Array.isArray(reviews) ? reviews : [];
  } catch {
    const reviews = await fetchReviewsFromFile(reviewKey);
    return Array.isArray(reviews) ? reviews : [];
  }
}

async function getUserPhotoByName(name) {
  const normalizedName = normalizeUserName(name);

  if (!normalizedName) {
    return "";
  }

  const cacheKey = normalizedName.toLowerCase();

  if (userPhotoCache.has(cacheKey)) {
    return userPhotoCache.get(cacheKey) || "";
  }

  try {
    const user = await apiGetUser(normalizedName);
    const photo = String(user?.photoDataUrl || "").trim();
    userPhotoCache.set(cacheKey, photo);
    return photo;
  } catch {
    userPhotoCache.set(cacheKey, "");
    return "";
  }
}

async function enrichReviewsWithPhotos(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) {
    return [];
  }

  const enriched = reviews.map((review) => ({
    ...review,
    photoDataUrl: String(review.photoDataUrl || "").trim()
  }));

  const tasks = enriched.map(async (review) => {
    if (review.photoDataUrl) {
      return;
    }

    const photo = await getUserPhotoByName(review.name);
    if (photo) {
      review.photoDataUrl = photo;
    }
  });

  await Promise.all(tasks);
  return enriched;
}

async function enrichLikesInReviews(reviews) {
  const toFetch = new Set();
  for (const r of reviews) {
    for (const l of (Array.isArray(r.likes) ? r.likes : [])) {
      if (!l.photoDataUrl && l.name) toFetch.add(l.name);
    }
  }

  if (!toFetch.size) return reviews;

  const photoMap = new Map();
  await Promise.all([...toFetch].map(async (name) => {
    const photo = await getUserPhotoByName(name);
    if (photo) photoMap.set(name.toLowerCase(), photo);
  }));

  return reviews.map((r) => ({
    ...r,
    likes: (Array.isArray(r.likes) ? r.likes : []).map((l) => ({
      ...l,
      photoDataUrl: l.photoDataUrl || photoMap.get((l.name || "").toLowerCase()) || ""
    }))
  }));
}

async function fetchCurrentSongReviews() {
  const songKey = getSongKey(currentNowPlaying);
  const albumKey = getAlbumReviewKey(currentNowPlaying);
  const reviewScope = currentNowPlaying?.reviewScope === "album" ? "album" : "song";

  if (!albumKey) {
    renderReviewBubbles([], "");
    return;
  }

  try {
    const [songReviews, albumReviews] = await Promise.all([
      reviewScope === "song" && songKey ? fetchReviewsForKey(songKey) : Promise.resolve([]),
      fetchReviewsForKey(albumKey)
    ]);

    const reviewItems = [
      ...songReviews.map((review) => ({ ...review, scope: "song", _reviewKey: songKey })),
      ...albumReviews.map((review) => ({ ...review, scope: "album", _reviewKey: albumKey }))
    ];

    const hydratedReviewItems = await enrichLikesInReviews(await enrichReviewsWithPhotos(reviewItems));
    const reviewGroups = groupReviewsByReviewer(hydratedReviewItems);
    const groupsWithNewLikes = checkForNewLikes(reviewGroups);

    renderReviewBubbles(hydratedReviewItems, `${songKey}|${albumKey}|${reviewScope}`);

    if (groupsWithNewLikes.length > 0) {
      requestAnimationFrame(() => {
        for (const group of groupsWithNewLikes) {
          spawnHeartOnBubble(group.reviewerKey);
        }
      });
    }
  } catch {
    renderReviewBubbles([], `${songKey}|${albumKey}|${reviewScope}`);
    showReviewStatus("No se pudieron cargar las reseñas.");
  }
}

async function apiLikeReview(songKey, reviewerName, likerName, likerPhotoDataUrl) {
  const res = await fetch("/api/reviews/like", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ songKey, reviewerName, likerName, likerPhotoDataUrl })
  });
  if (!res.ok) throw new Error("Like failed");
  return res.json();
}

async function handleLikeReview(reviewKey, reviewerName, likeBtn) {
  const userName = sessionState.currentUser?.name;
  if (!userName || !reviewKey || !reviewerName) return;

  const wasLiked = likeBtn.classList.contains("liked");
  likeBtn.classList.toggle("liked", !wasLiked);
  likeBtn.textContent = !wasLiked ? "❤️" : "🤍";

  try {
    await apiLikeReview(reviewKey, reviewerName, userName, String(sessionState.currentUser?.photoDataUrl || "").trim());
  } catch {
    likeBtn.classList.toggle("liked", wasLiked);
    likeBtn.textContent = wasLiked ? "❤️" : "🤍";
  }
}

function spawnFloatingHeart() {
  const heart = document.createElement("div");
  heart.className = "floating-heart";
  heart.textContent = "❤️";
  heart.style.left = `${15 + Math.random() * 70}vw`;
  heart.style.bottom = `${10 + Math.random() * 35}vh`;
  document.body.appendChild(heart);
  heart.addEventListener("animationend", () => heart.remove(), { once: true });
}

function spawnHeartOnBubble(reviewerKey) {
  const bubble = document.querySelector(`[data-review-id="${encodeURIComponent(reviewerKey)}"]`);
  if (!bubble) return;
  const rect = bubble.getBoundingClientRect();
  const heart = document.createElement("div");
  heart.className = "floating-heart";
  heart.textContent = "❤️";
  heart.style.left = `${rect.left + rect.width / 2 - 14}px`;
  heart.style.top = `${rect.top - 4}px`;
  document.body.appendChild(heart);
  heart.addEventListener("animationend", () => heart.remove(), { once: true });
}

const knownLikeMap = new Map();

function checkForNewLikes(reviewGroups) {
  const currentUserKey = getReviewerKey(sessionState.currentUser?.name || "");
  const groupsWithNewLikes = [];

  for (const group of reviewGroups) {
    const known = knownLikeMap.get(group.reviewerKey) || new Set();
    let hasNew = false;

    for (const liker of group.likes) {
      const likerKey = getReviewerKey(liker.name || "");
      if (likerKey && !known.has(likerKey)) {
        known.add(likerKey);
        hasNew = true;
      }
    }

    knownLikeMap.set(group.reviewerKey, known);

    if (hasNew) {
      groupsWithNewLikes.push(group);
      if (currentUserKey && getReviewerKey(group.displayName) === currentUserKey) {
        spawnFloatingHeart();
        setTimeout(spawnFloatingHeart, 220);
      }
    }
  }

  return groupsWithNewLikes;
}

function startReviewPolling() {
  const refresh = () => {
    if (currentNowPlaying) {
      void fetchCurrentSongReviews();
    }
  };

  refresh();
  window.setInterval(refresh, 2000);
}

function getReviewerKey(name) {
  return (name || "Anonymous").trim().toLowerCase();
}

function formatReviewDate(isoDate) {
  if (!isoDate) {
    return "Fecha desconocida";
  }

  if (/^\d{2}\/\d{2}\/\d{2}$/.test(isoDate)) {
    return isoDate;
  }

  const value = new Date(isoDate);

  if (Number.isNaN(value.getTime())) {
    return "Fecha desconocida";
  }

  return value.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function groupReviewsByReviewer(reviews) {
  const grouped = new Map();

  reviews.forEach((review) => {
    const scope = review.scope === "album" ? "album" : "song";
    const normalizedKey = getReviewerKey(review.name);
    const safeName = (review.name || "Anonymous").trim() || "Anonymous";
    const groupKey = `${scope}::${normalizedKey}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        reviewerKey: groupKey,
        scope,
        displayName: safeName,
        reviewApiKey: review._reviewKey || "",
        reviews: []
      });
    }

    const grp = grouped.get(groupKey);
    if (!grp.reviewApiKey && review._reviewKey) grp.reviewApiKey = review._reviewKey;
    grp.reviews.push({
      name: safeName,
      text: review.text || "",
      rating: Number(review.rating || 0),
      createdAt: review.createdAt || "",
      scope,
      photoDataUrl: String(review.photoDataUrl || "").trim(),
      likes: Array.isArray(review.likes) ? review.likes : []
    });
  });

  return Array.from(grouped.values()).map((group) => {
    const sortedReviews = group.reviews
      .slice()
      .sort((a, b) => {
        const timeA = Date.parse(a.createdAt) || 0;
        const timeB = Date.parse(b.createdAt) || 0;
        return timeA - timeB;
      });

    const total = sortedReviews.reduce((sum, item) => sum + Number(item.rating || 0), 0);
    const average = sortedReviews.length ? total / sortedReviews.length : 0;

    const allLikes = [];
    const seenLikers = new Set();
    for (const r of sortedReviews) {
      for (const l of (Array.isArray(r.likes) ? r.likes : [])) {
        const key = String(l.name || "").toLowerCase();
        if (key && !seenLikers.has(key)) {
          seenLikers.add(key);
          allLikes.push(l);
        }
      }
    }

    return {
      reviewerKey: group.reviewerKey,
      reviewApiKey: group.reviewApiKey || "",
      scope: group.scope,
      displayName: group.displayName,
      averageRating: average,
      avatarUrl: sortedReviews.find((entry) => entry.photoDataUrl)?.photoDataUrl || "",
      reviews: sortedReviews,
      likes: allLikes
    };
  });
}

function renderReviewBubbles(reviews, signature = "") {
  const bubbleLayer = document.getElementById("bubble-layer");
  const currentUserKey = getReviewerKey(sessionState.currentUser?.name || "");
  const reviewsSignature = JSON.stringify(reviews);
  const combinedSignature = `${signature}::${reviewsSignature}::${currentUserKey}`;

  if (!bubbleLayer) {
    return;
  }

  if (combinedSignature === lastBubbleSignature) {
    return;
  }

  if (!reviews.length) {
    bubbleLayer.innerHTML = "";
    lastBubbleSignature = combinedSignature;
    syncBubblesFromDom();
    return;
  }

  const reviewGroups = groupReviewsByReviewer(reviews).slice(-8);

  bubbleLayer.innerHTML = reviewGroups
    .map((group) => {
      const id = group.reviewerKey;
      const encodedId = encodeURIComponent(id);
      const savedState = bubbleUiState.get(id);
      const expanded = savedState?.expanded ?? false;
      const safeName = escapeHtml(group.displayName);
      const safeAverage = Number(group.averageRating || 0).toFixed(1);
      const bubbleClass = group.scope === "album" ? "album-review" : "song-review";
      const scopeLabel = group.scope === "album" ? "Album" : "Cancion";
      const safeAvatarUrl = escapeHtml(group.avatarUrl || "");
      const hasAvatar = Boolean(group.avatarUrl);
      const headerMarkup = hasAvatar
        ? `
            <div class="review-avatar-badge">
              <img class="review-avatar-image" src="${safeAvatarUrl}" alt="Avatar de ${safeName}" loading="lazy" />
              <span class="review-avatar-score">${safeAverage} / 5</span>
            </div>
            <p class="review-bubble-scope">${scopeLabel}</p>
          `
        : `
            <p class="review-bubble-name">${safeName}</p>
            <p class="review-bubble-scope">${scopeLabel}</p>
            <p class="review-bubble-rating">Avg ${safeAverage} / 5</p>
          `;
      const historyMarkup = group.reviews
        .map((entry) => {
          const entryText = String(entry.text || "").trim();
          const safeText = entryText ? escapeHtml(entryText) : "";
          const safeRating = Number(entry.rating || 0).toFixed(1);
          const safeDate = escapeHtml(formatReviewDate(entry.createdAt));
          const textMarkup = safeText ? `<p class="review-history-text">${safeText}</p>` : "";

          return `
            <li class="review-history-item">
              <p class="review-history-meta">${safeDate} - ${safeRating} / 5</p>
              ${textMarkup}
            </li>
          `;
        })
        .join("");

      const isOwnReview = getReviewerKey(group.displayName) === currentUserKey;
      const alreadyLiked = !isOwnReview && group.likes.some((l) => getReviewerKey(l.name || "") === currentUserKey);

      const heartsStrip = group.likes.length
        ? `<div class="review-bubble-hearts">${group.likes.slice(0, 7).map(() => "❤️").join("")}${group.likes.length > 7 ? `<span class="review-hearts-more">+${group.likes.length - 7}</span>` : ""}</div>`
        : "";

      const likerPhotosMarkup = group.likes.map((l) => {
        const safeLikerName = escapeHtml(String(l.name || "?"));
        return l.photoDataUrl
          ? `<img class="liker-avatar" src="${escapeHtml(l.photoDataUrl)}" alt="${safeLikerName}" title="${safeLikerName}" loading="lazy" />`
          : `<span class="liker-initial" title="${safeLikerName}">${escapeHtml(String(l.name || "?")[0].toUpperCase())}</span>`;
      }).join("");
      const heartIcon = alreadyLiked ? "❤️" : "🤍";
      const likeBtnMarkup = !isOwnReview && currentUserKey
        ? `<button class="like-btn${alreadyLiked ? " liked" : ""}" aria-label="Me gusta">${heartIcon}</button>`
        : "";
      const likesSectionMarkup = `<div class="review-likes-section">${likeBtnMarkup}${likerPhotosMarkup}</div>`;

      return `
        <article class="review-bubble ${bubbleClass} ${expanded ? "expanded" : ""}"
          data-review-id="${encodedId}"
          data-review-key="${encodeURIComponent(group.reviewApiKey || "")}"
          data-reviewer-name="${encodeURIComponent(group.displayName)}"
          style="left:0;top:0;">
          <div class="review-bubble-summary">
            ${headerMarkup}
            ${heartsStrip}
          </div>
          <ol class="review-bubble-text review-history-list">${historyMarkup}</ol>
          ${likesSectionMarkup}
        </article>
      `;
    })
    .join("");

  lastBubbleSignature = combinedSignature;
  syncBubblesFromDom();
}

function spawnBubbleEntity(lw, lh, r) {
  const margin = r + 4;
  const x = margin + Math.random() * Math.max(1, lw - 2 * margin);
  const y = margin + Math.random() * Math.max(1, lh - 2 * margin);
  const angle = Math.random() * Math.PI * 2;
  const speed = 45 + Math.random() * 40;
  return { el: null, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, isDragging: false, baseSpeed: speed };
}

function syncBubblesFromDom() {
  const reviewLayer = document.getElementById("bubble-layer");
  const userLayer = document.getElementById("active-users-layer");
  const lw = window.innerWidth;
  const lh = window.innerHeight;
  const seenKeys = new Set();

  if (reviewLayer) {
    for (const el of reviewLayer.querySelectorAll(".review-bubble")) {
      const raw = el.dataset.reviewId ? decodeURIComponent(el.dataset.reviewId) : null;
      if (!raw) continue;
      const key = `r::${raw}`;
      seenKeys.add(key);
      if (!bubbleEntities.has(key)) {
        const e = spawnBubbleEntity(lw, lh, 36);
        bubbleEntities.set(key, e);
      }
      const e = bubbleEntities.get(key);
      e.el = el;
      el.style.left = `${e.x - e.r}px`;
      el.style.top = `${e.y - e.r}px`;
    }
  }

  if (userLayer) {
    for (const el of userLayer.querySelectorAll(".active-user-bubble")) {
      const raw = el.dataset.userKey ? decodeURIComponent(el.dataset.userKey) : null;
      if (!raw) continue;
      const key = `u::${raw}`;
      seenKeys.add(key);
      if (!bubbleEntities.has(key)) {
        const e = spawnBubbleEntity(lw, lh, 21);
        bubbleEntities.set(key, e);
      }
      const e = bubbleEntities.get(key);
      e.el = el;
      el.style.left = `${e.x - e.r}px`;
      el.style.top = `${e.y - e.r}px`;
    }
  }

  for (const key of bubbleEntities.keys()) {
    if (!seenKeys.has(key)) bubbleEntities.delete(key);
  }

  startPhysicsLoop();
}

function stepPhysics(dt) {
  const lw = window.innerWidth;
  const lh = window.innerHeight;
  const entities = [...bubbleEntities.values()].filter(e => e.el);
  const active = entities.filter(e => !e.isDragging && !e.el.classList.contains("expanded"));

  for (const e of active) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;

    if (e.x - e.r < 0) { e.x = e.r; e.vx = Math.abs(e.vx); }
    else if (e.x + e.r > lw) { e.x = lw - e.r; e.vx = -Math.abs(e.vx); }
    if (e.y - e.r < 0) { e.y = e.r; e.vy = Math.abs(e.vy); }
    else if (e.y + e.r > lh) { e.y = lh - e.r; e.vy = -Math.abs(e.vy); }

    // Decay excess speed back toward the bubble's natural wandering speed
    const spd = Math.hypot(e.vx, e.vy);
    if (spd > e.baseSpeed && spd > 0.1) {
      const newSpd = e.baseSpeed + (spd - e.baseSpeed) * Math.exp(-1.8 * dt);
      const scale = newSpd / spd;
      e.vx *= scale;
      e.vy *= scale;
    }

    e.el.style.left = `${e.x - e.r}px`;
    e.el.style.top = `${e.y - e.r}px`;
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const minDist = a.r + b.r;
      if (dist >= minDist) continue;

      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = (minDist - dist) * 0.5;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;

      const dvx = a.vx - b.vx;
      const dvy = a.vy - b.vy;
      const impulse = dvx * nx + dvy * ny;
      if (impulse > 0) {
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }

      a.el.style.left = `${a.x - a.r}px`;
      a.el.style.top = `${a.y - a.r}px`;
      b.el.style.left = `${b.x - b.r}px`;
      b.el.style.top = `${b.y - b.r}px`;
    }
  }
}

function startPhysicsLoop() {
  if (physicsRafId) return;
  let prevTime = performance.now();
  function tick(now) {
    physicsRafId = requestAnimationFrame(tick);
    const dt = Math.min((now - prevTime) / 1000, 0.05);
    prevTime = now;
    stepPhysics(dt);
  }
  physicsRafId = requestAnimationFrame(tick);
}

function setupBubbleInteractions() {
  const bubbleLayer = document.getElementById("bubble-layer");

  if (!bubbleLayer) {
    return;
  }

  bubbleLayer.addEventListener("pointerup", (event) => {
    const likeBtn = event.target.closest(".like-btn");
    if (!likeBtn) return;
    const bubble = likeBtn.closest(".review-bubble");
    if (!bubble) return;
    const reviewKey = bubble.dataset.reviewKey ? decodeURIComponent(bubble.dataset.reviewKey) : "";
    const reviewerName = bubble.dataset.reviewerName ? decodeURIComponent(bubble.dataset.reviewerName) : "";
    void handleLikeReview(reviewKey, reviewerName, likeBtn);
  });

  bubbleLayer.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".like-btn")) return;

    const bubble = event.target.closest(".review-bubble");

    if (!bubble) {
      return;
    }

    const layerRect = bubbleLayer.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const bubbleId = bubble.dataset.reviewId ? decodeURIComponent(bubble.dataset.reviewId) : "";

    activeBubbleDrag = {
      bubble,
      bubbleId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeftPx: bubbleRect.left - layerRect.left,
      originTopPx: bubbleRect.top - layerRect.top,
      moved: false,
      velX: 0,
      velY: 0,
      lastMoveX: event.clientX,
      lastMoveY: event.clientY,
      lastMoveTime: performance.now()
    };

    const rEntity = bubbleEntities.get(`r::${bubbleId}`);
    if (rEntity) rEntity.isDragging = true;

    bubble.classList.add("dragging");
    bubble.setPointerCapture(event.pointerId);
  });

  bubbleLayer.addEventListener("pointermove", (event) => {
    if (!activeBubbleDrag || activeBubbleDrag.pointerId !== event.pointerId) {
      return;
    }

    const layerRect = bubbleLayer.getBoundingClientRect();
    const bubbleRect = activeBubbleDrag.bubble.getBoundingClientRect();
    const deltaX = event.clientX - activeBubbleDrag.startX;
    const deltaY = event.clientY - activeBubbleDrag.startY;
    const travel = Math.hypot(deltaX, deltaY);

    if (travel > 4) {
      activeBubbleDrag.moved = true;
    }

    const nextLeft = activeBubbleDrag.originLeftPx + deltaX;
    const nextTop = activeBubbleDrag.originTopPx + deltaY;
    const maxLeft = layerRect.width - bubbleRect.width;
    const maxTop = layerRect.height - bubbleRect.height;
    const boundedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    const boundedTop = Math.max(0, Math.min(maxTop, nextTop));

    activeBubbleDrag.bubble.style.left = `${boundedLeft}px`;
    activeBubbleDrag.bubble.style.top = `${boundedTop}px`;

    const rEntity = bubbleEntities.get(`r::${activeBubbleDrag.bubbleId}`);
    if (rEntity) {
      rEntity.x = boundedLeft + rEntity.r;
      rEntity.y = boundedTop + rEntity.r;
    }

    const nowMs = performance.now();
    const dtMs = nowMs - activeBubbleDrag.lastMoveTime;
    if (dtMs > 0 && dtMs < 100) {
      activeBubbleDrag.velX = (event.clientX - activeBubbleDrag.lastMoveX) / dtMs * 1000;
      activeBubbleDrag.velY = (event.clientY - activeBubbleDrag.lastMoveY) / dtMs * 1000;
    }
    activeBubbleDrag.lastMoveX = event.clientX;
    activeBubbleDrag.lastMoveY = event.clientY;
    activeBubbleDrag.lastMoveTime = nowMs;
  });

  const endDrag = (event) => {
    if (!activeBubbleDrag || activeBubbleDrag.pointerId !== event.pointerId) {
      return;
    }

    const { bubble, bubbleId, moved } = activeBubbleDrag;

    bubble.classList.remove("dragging");
    bubble.releasePointerCapture(event.pointerId);

    const rEntity = bubbleEntities.get(`r::${bubbleId}`);
    if (rEntity) {
      rEntity.isDragging = false;
      if (moved) {
        const rawSpeed = Math.hypot(activeBubbleDrag.velX, activeBubbleDrag.velY);
        const clamp = rawSpeed > 600 ? 600 / rawSpeed : 1;
        rEntity.vx = activeBubbleDrag.velX * clamp;
        rEntity.vy = activeBubbleDrag.velY * clamp;
      }
    }

    if (!moved && bubbleId) {
      const current = bubbleUiState.get(bubbleId) || {};
      const nextExpanded = !current.expanded;
      bubbleUiState.set(bubbleId, { ...current, expanded: nextExpanded });
      bubble.classList.toggle("expanded", nextExpanded);
    }

    activeBubbleDrag = null;
  };

  bubbleLayer.addEventListener("pointerup", endDrag);
  bubbleLayer.addEventListener("pointercancel", endDrag);
}

function setupActiveUserBubbleInteractions() {
  const activeUsersLayer = document.getElementById("active-users-layer");

  if (!activeUsersLayer) {
    return;
  }

  activeUsersLayer.addEventListener("pointerdown", (event) => {
    const igBtn = event.target.closest(".active-user-instagram-link");
    if (igBtn) {
      event.stopPropagation();
      window.open(`https://instagram.com/${igBtn.dataset.instagram}`, "_blank", "noopener,noreferrer");
      return;
    }

    const spotifyBtn = event.target.closest(".active-user-spotify-link");
    if (spotifyBtn) {
      event.stopPropagation();
      return;
    }

    const bubble = event.target.closest(".active-user-bubble");

    if (!bubble) {
      return;
    }

    const layerRect = activeUsersLayer.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const bubbleId = bubble.dataset.userKey ? decodeURIComponent(bubble.dataset.userKey) : "";

    activeUserBubbleDrag = {
      bubble,
      bubbleId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeftPx: bubbleRect.left - layerRect.left,
      originTopPx: bubbleRect.top - layerRect.top,
      moved: false,
      velX: 0,
      velY: 0,
      lastMoveX: event.clientX,
      lastMoveY: event.clientY,
      lastMoveTime: performance.now()
    };

    const uEntity = bubbleEntities.get(`u::${bubbleId}`);
    if (uEntity) uEntity.isDragging = true;

    bubble.classList.add("dragging");
    bubble.setPointerCapture(event.pointerId);
  });

  activeUsersLayer.addEventListener("pointermove", (event) => {
    if (!activeUserBubbleDrag || activeUserBubbleDrag.pointerId !== event.pointerId) {
      return;
    }

    const layerRect = activeUsersLayer.getBoundingClientRect();
    const bubbleRect = activeUserBubbleDrag.bubble.getBoundingClientRect();
    const deltaX = event.clientX - activeUserBubbleDrag.startX;
    const deltaY = event.clientY - activeUserBubbleDrag.startY;
    const travel = Math.hypot(deltaX, deltaY);

    if (travel > 4) {
      activeUserBubbleDrag.moved = true;
    }

    const nextLeft = activeUserBubbleDrag.originLeftPx + deltaX;
    const nextTop = activeUserBubbleDrag.originTopPx + deltaY;
    const maxLeft = layerRect.width - bubbleRect.width;
    const maxTop = layerRect.height - bubbleRect.height;
    const boundedLeft = Math.max(0, Math.min(maxLeft, nextLeft));
    const boundedTop = Math.max(0, Math.min(maxTop, nextTop));

    activeUserBubbleDrag.bubble.style.left = `${boundedLeft}px`;
    activeUserBubbleDrag.bubble.style.top = `${boundedTop}px`;

    const uEntity = bubbleEntities.get(`u::${activeUserBubbleDrag.bubbleId}`);
    if (uEntity) {
      uEntity.x = boundedLeft + uEntity.r;
      uEntity.y = boundedTop + uEntity.r;
    }

    const nowMs = performance.now();
    const dtMs = nowMs - activeUserBubbleDrag.lastMoveTime;
    if (dtMs > 0 && dtMs < 100) {
      activeUserBubbleDrag.velX = (event.clientX - activeUserBubbleDrag.lastMoveX) / dtMs * 1000;
      activeUserBubbleDrag.velY = (event.clientY - activeUserBubbleDrag.lastMoveY) / dtMs * 1000;
    }
    activeUserBubbleDrag.lastMoveX = event.clientX;
    activeUserBubbleDrag.lastMoveY = event.clientY;
    activeUserBubbleDrag.lastMoveTime = nowMs;
  });

  const endDrag = (event) => {
    if (!activeUserBubbleDrag || activeUserBubbleDrag.pointerId !== event.pointerId) {
      return;
    }

    const { bubble, bubbleId, moved } = activeUserBubbleDrag;

    bubble.classList.remove("dragging");
    bubble.releasePointerCapture(event.pointerId);

    const uEntity = bubbleEntities.get(`u::${bubbleId}`);
    if (uEntity) {
      uEntity.isDragging = false;
      if (moved) {
        const rawSpeed = Math.hypot(activeUserBubbleDrag.velX, activeUserBubbleDrag.velY);
        const clamp = rawSpeed > 600 ? 600 / rawSpeed : 1;
        uEntity.vx = activeUserBubbleDrag.velX * clamp;
        uEntity.vy = activeUserBubbleDrag.velY * clamp;
      }
    }

    if (!moved && bubbleId) {
      const current = activeUserBubbleUiState.get(bubbleId) || {};
      const nextExpanded = !current.expanded;
      activeUserBubbleUiState.set(bubbleId, { ...current, expanded: nextExpanded });
      bubble.classList.toggle("expanded", nextExpanded);
    }

    activeUserBubbleDrag = null;
  };

  activeUsersLayer.addEventListener("pointerup", endDrag);
  activeUsersLayer.addEventListener("pointercancel", endDrag);

  activeUsersLayer.addEventListener("click", (event) => {
    const spotifyBtn = event.target.closest(".active-user-spotify-link");
    if (spotifyBtn) {
      window.open(spotifyBtn.dataset.spotify, "_blank", "noopener,noreferrer");
    }
  });
}

function setupBubbleOutsideClickHandler() {
  document.addEventListener("pointerdown", (event) => {
    // Close expanded review bubbles
    const expandedReview = document.querySelector(".review-bubble.expanded");
    if (expandedReview && !expandedReview.contains(event.target)) {
      const bubbleId = expandedReview.dataset.reviewId
        ? decodeURIComponent(expandedReview.dataset.reviewId)
        : null;
      if (bubbleId) {
        const current = bubbleUiState.get(bubbleId) || {};
        bubbleUiState.set(bubbleId, { ...current, expanded: false });
      }
      expandedReview.classList.remove("expanded");
    }

    // Close expanded active-user bubbles
    const expandedUser = document.querySelector(".active-user-bubble.expanded");
    if (expandedUser && !expandedUser.contains(event.target)) {
      const bubbleId = expandedUser.dataset.userKey
        ? decodeURIComponent(expandedUser.dataset.userKey)
        : null;
      if (bubbleId) {
        const current = activeUserBubbleUiState.get(bubbleId) || {};
        activeUserBubbleUiState.set(bubbleId, { ...current, expanded: false });
      }
      expandedUser.classList.remove("expanded");
    }
  }, { capture: true });
}

function showReviewStatus(message) {
  const status = document.getElementById("review-status");

  if (!status) {
    return;
  }

  status.textContent = message;
}

function resetReviewInputs() {
  const reviewInput = document.getElementById("album-review");

  if (reviewInput) {
    reviewInput.value = "";
  }

  selectedRating = 0;
  renderRating(selectedRating);
}

function closeReviewPanel() {
  const panel = document.getElementById("review-panel");
  const toggle = document.getElementById("now-playing-toggle");

  if (panel) {
    panel.hidden = true;
  }

  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
  }
}

async function saveCurrentReview() {
  const reviewInput = document.getElementById("album-review");
  const key = getActiveReviewKey(currentNowPlaying);
  const scope = currentNowPlaying?.reviewScope === "album" ? "album" : "song";
  const userName = normalizeUserName(sessionState.currentUser?.name || "");

  if (!userName) {
    showReviewStatus("Inicia sesion para guardar una reseña.");
    return;
  }

  if (!currentNowPlaying || !key) {
    showReviewStatus("No hay objetivo de reseña activo.");
    return;
  }

  const text = (reviewInput?.value || "").trim();

  if (selectedRating <= 0) {
    showReviewStatus("Selecciona una puntuacion entre 0.5 y 5.");
    return;
  }

  try {
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        songKey: key,
        scope,
        partyId: currentNowPlaying?.partyId || null,
        review: {
          name: userName,
          photoDataUrl: String(sessionState.currentUser?.photoDataUrl || "").trim(),
          text,
          rating: selectedRating,
          createdAt: new Date().toISOString()
        }
      })
    });

    if (!response.ok) {
      throw new Error("No se pudo guardar la reseña");
    }

    await response.json();
    resetReviewInputs();
    closeReviewPanel();
    void fetchCurrentSongReviews();
  } catch {
    showReviewStatus("No se pudo guardar la reseña.");
  }
}

function renderRating(rating) {
  const starButtons = document.querySelectorAll(".star-button");
  const ratingValue = document.getElementById("rating-value");

  starButtons.forEach((button) => {
    const starNumber = Number(button.dataset.star);
    button.classList.remove("full", "half");

    if (rating >= starNumber) {
      button.classList.add("full");
      return;
    }

    if (rating >= starNumber - 0.5) {
      button.classList.add("half");
    }
  });

  if (ratingValue) {
    ratingValue.textContent = `Puntuacion: ${rating} / 5`;
  }
}

function updateReviewTargetCopy(nowPlaying) {
  const hint = document.querySelector(".now-playing-hint");
  const reviewLabel = document.querySelector("label[for='album-review']");
  const reviewScope = nowPlaying?.reviewScope === "album" ? "album" : "song";

  if (hint) {
    hint.textContent = reviewScope === "album"
      ? "Toca para calificar este album"
      : "Toca para calificar esta cancion";
  }

  if (reviewLabel) {
    reviewLabel.textContent = reviewScope === "album" ? "Reseña del album" : "Reseña de la cancion";
  }
}

function setupNowPlayingInteractions() {
  const toggle = document.getElementById("now-playing-toggle");
  const panel = document.getElementById("review-panel");
  const ratingContainer = document.getElementById("star-rating");
  const saveButton = document.getElementById("save-review");
  const openAlbumButton = document.getElementById("open-now-playing-album");
  const stopNowPlayingButton = document.getElementById("now-playing-stop");
  const addPictureButton = document.getElementById("now-playing-add-picture");
  const pictureInput = document.getElementById("now-playing-picture-input");

  if (!toggle || !panel || !ratingContainer || !saveButton || !openAlbumButton || !stopNowPlayingButton) {
    return;
  }

  toggle.addEventListener("click", () => {
    if (!sessionState.currentUser?.name) {
      showReviewStatus("Inicia sesion para calificar.");
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      return;
    }

    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    toggle.setAttribute("aria-expanded", String(!isOpen));
  });

  ratingContainer.addEventListener("click", (event) => {
    const starButton = event.target.closest(".star-button");

    if (!starButton) {
      return;
    }

    const starNumber = Number(starButton.dataset.star);
    const bounds = starButton.getBoundingClientRect();
    const clickedHalf = event.clientX < bounds.left + bounds.width / 2;

    selectedRating = starNumber - (clickedHalf ? 0.5 : 0);
    renderRating(selectedRating);
  });

  saveButton.addEventListener("click", async () => {
    await saveCurrentReview();
  });

  openAlbumButton.addEventListener("click", () => {
    openNowPlayingAlbumInGrid();
  });

  stopNowPlayingButton.addEventListener("click", async () => {
    if (!isAdminUser() || !sessionState.currentUser?.name) {
      showReviewStatus("Solo administrador puede finalizar la reproduccion actual.");
      return;
    }

    try {
      await apiClearNowPlaying(sessionState.currentUser.name);
      hideNowPlaying();
      showReviewStatus("Reproduccion actual finalizada.");
    } catch (error) {
      showReviewStatus(error instanceof Error ? error.message : "No se pudo finalizar la reproduccion actual.");
    }
  });

  if (addPictureButton && pictureInput) {
    addPictureButton.addEventListener("click", () => {
      pictureInput.click();
    });

    pictureInput.addEventListener("change", async (event) => {
      const files = event.currentTarget?.files;
      if (!files || files.length === 0) {
        return;
      }

      const file = files[0];

      if (!isAdminUser()) {
        showReviewStatus("Solo administrador puede agregar fotos.");
        pictureInput.value = "";
        return;
      }

      try {
        const pictureDataUrl = await readFileAsDataUrl(file);
        await apiAddPartyPicture(pictureDataUrl);
        showReviewStatus("Foto agregada a la sesion.");
        pictureInput.value = "";
      } catch (error) {
        showReviewStatus(error instanceof Error ? error.message : "No se pudo agregar la foto.");
      }
    });
  }

  renderRating(selectedRating);
}

function renderNowPlaying(nowPlaying) {
  const section = document.getElementById("now-playing");
  const cover = document.getElementById("now-playing-cover");
  const text = document.getElementById("now-playing-text");
  const stopControls = document.getElementById("now-playing-controls");
  const reviewScope = nowPlaying?.reviewScope === "album" ? "album" : "song";

  if (!section || !cover || !text) {
    return;
  }

  if (!nowPlaying || !nowPlaying.albumTitle || !nowPlaying.coverUrl) {
    hideNowPlaying();
    return;
  }

  const signature = `${nowPlaying.albumTitle}|${nowPlaying.songTitle || ""}|${nowPlaying.coverUrl}|${reviewScope}`;

  if (signature !== lastNowPlayingSignature || section.hidden) {
    text.textContent = reviewScope === "album"
      ? `Review de album: ${nowPlaying.albumTitle}`
      : `${nowPlaying.albumTitle} - ${nowPlaying.songTitle}`;
    cover.onerror = () => {
      cover.onerror = null;
      cover.src = coverFallbackUrl;
    };
    cover.src = nowPlaying.coverUrl;
    cover.alt = `${nowPlaying.albumTitle} album cover`;
    cover.classList.remove("np-cover-arriving");
    cover.classList.add("np-cover-arriving");
    cover.addEventListener("animationend", () => cover.classList.remove("np-cover-arriving"), { once: true });
    section.hidden = false;
    lastNowPlayingSignature = signature;
    document.documentElement.style.setProperty("--layout-top-space", "5.5rem");

    const playingAlbum = findAlbumByNowPlaying(nowPlaying);
    if (playingAlbum && appState.expandedAlbumId !== playingAlbum.id) {
      openAlbumInGrid(playingAlbum);
    }
  }

  if (stopControls) {
    stopControls.hidden = !isAdminUser();
  }

  applyNowPlayingDiscVisual(nowPlaying);
  currentNowPlaying = nowPlaying;
  updateReviewTargetCopy(nowPlaying);
  void fetchCurrentSongReviews();
}

async function loadNowPlaying() {
  const response = await fetch(`./now-playing.json?t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not load now-playing.json");
  }

  return response.json();
}

let lastKnownPartyActive = false;

function startNowPlayingPolling() {
  const refresh = () => {
    loadNowPlaying()
      .then((data) => {
        const isActive = !!(data && data.albumTitle && data.coverUrl);
        if (lastKnownPartyActive && !isActive) {
          void handlePartyJustEnded();
        }
        lastKnownPartyActive = isActive;
        renderNowPlaying(data);
      })
      .catch(() => {
        if (lastKnownPartyActive) {
          void handlePartyJustEnded();
        }
        lastKnownPartyActive = false;
        hideNowPlaying();
      });
  };

  refresh();
  window.setInterval(refresh, 2000);
}

function setupAuthInteractions() {
  const authName = document.getElementById("auth-name");
  const authPassword = document.getElementById("auth-password");
  const authPhoto = document.getElementById("auth-photo");
  const authModalTitle = document.getElementById("auth-modal-title");
  const authModalHelp = document.getElementById("auth-modal-help");
  const authSwitchLabel = document.getElementById("auth-switch-label");
  const loginButton = document.getElementById("auth-login");
  const registerButton = document.getElementById("auth-register");
  const avatarButton = document.getElementById("profile-avatar-button");
  const changePhotoButton = document.getElementById("change-photo");
  const changePhotoInput = document.getElementById("change-photo-input");
  const viewReviewsButton = document.getElementById("view-reviews");
  const openProfileButton = document.getElementById("open-profile");
  const profileDescription = document.getElementById("profile-description");
  const profileInstagram = document.getElementById("profile-instagram");
  const profileSpotify = document.getElementById("profile-spotify");
  const profileSpotifyError = document.getElementById("profile-spotify-error");
  const profileTopAlbum1 = document.getElementById("profile-top-album-1");
  const profileTopAlbum1Artist = document.getElementById("profile-top-album-1-artist");
  const profileTopAlbum2 = document.getElementById("profile-top-album-2");
  const profileTopAlbum2Artist = document.getElementById("profile-top-album-2-artist");
  const profileTopAlbum3 = document.getElementById("profile-top-album-3");
  const profileTopAlbum3Artist = document.getElementById("profile-top-album-3-artist");
  const profileTopAlbum1Cover = document.getElementById("profile-top-album-1-cover");
  const profileTopAlbum2Cover = document.getElementById("profile-top-album-2-cover");
  const profileTopAlbum3Cover = document.getElementById("profile-top-album-3-cover");
  const saveProfileButton = document.getElementById("save-profile");
  const profileSaveStatus = document.getElementById("profile-save-status");
  const logoutButton = document.getElementById("logout-profile");
  const reviewsBackButton = document.getElementById("reviews-back");
  const profileBackButton = document.getElementById("profile-back");

  if (!authName || !authPassword || !authPhoto || !authModalTitle || !authModalHelp || !authSwitchLabel || !loginButton || !registerButton || !avatarButton || !changePhotoButton || !changePhotoInput || !viewReviewsButton || !openProfileButton || !profileDescription || !profileInstagram || !profileTopAlbum1 || !profileTopAlbum1Artist || !profileTopAlbum2 || !profileTopAlbum2Artist || !profileTopAlbum3 || !profileTopAlbum3Artist || !profileTopAlbum1Cover || !profileTopAlbum2Cover || !profileTopAlbum3Cover || !saveProfileButton || !profileSaveStatus || !logoutButton || !reviewsBackButton || !profileBackButton) {
    return;
  }

  let authMode = "login";

  const setAuthMode = (mode) => {
    authMode = mode === "register" ? "register" : "login";

    if (authMode === "register") {
      authModalTitle.textContent = "Crear cuenta";
      authModalHelp.textContent = "Elige nombre y contraseña para registrarte";
      loginButton.textContent = "Crear usuario";
      authSwitchLabel.textContent = "Ya tienes cuenta?";
      registerButton.textContent = "Entrar";
    } else {
      authModalTitle.textContent = "Inicia sesion";
      authModalHelp.textContent = "Escribe tu nombre y contraseña";
      loginButton.textContent = "Entrar";
      authSwitchLabel.textContent = "No tienes cuenta?";
      registerButton.textContent = "Registrarte";
    }

    setAuthStatus("");
  };

  const submitLogin = async () => {
    const name = normalizeUserName(authName.value);
    const password = String(authPassword.value || "").trim();

    if (!name) {
      setAuthStatus("Escribe tu nombre.");
      return;
    }

    if (!password) {
      setAuthStatus("Escribe tu Contraseña.");
      return;
    }

    try {
      setAuthStatus("Entrando...");
      const user = await apiLogin(name, password);
      if (!user) {
        throw new Error("No se encontro el usuario.");
      }
      setCurrentUser(user);
      await refreshActiveUsersNow();
      setAuthStatus("");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "No se pudo iniciar sesion.");
    }
  };

  const submitRegister = async () => {
    const name = normalizeUserName(authName.value);
    const password = String(authPassword.value || "").trim();

    if (!name) {
      setAuthStatus("Escribe un nombre para crear el usuario.");
      return;
    }

    if (!password) {
      setAuthStatus("Escribe una Contraseña para crear el usuario.");
      return;
    }

    try {
      setAuthStatus("Creando usuario...");
      const file = authPhoto.files && authPhoto.files[0] ? authPhoto.files[0] : null;
      const photoDataUrl = file ? await readFileAsDataUrl(file) : "";
      const user = await apiRegister(name, password, photoDataUrl);
      if (!user) {
        throw new Error("No se pudo crear el perfil.");
      }
      setCurrentUser(user);
      await refreshActiveUsersNow();
      authPhoto.value = "";
      authPassword.value = "";
      setAuthStatus("");
      openProfileView();
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "No se pudo crear el usuario.");
    }
  };

  loginButton.addEventListener("click", async () => {
    if (authMode === "register") {
      await submitRegister();
      return;
    }

    await submitLogin();
  });

  registerButton.addEventListener("click", async () => {
    setAuthMode(authMode === "login" ? "register" : "login");
    authPassword.focus();
  });

  authName.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (authMode === "register") {
      await submitRegister();
      return;
    }
    await submitLogin();
  });

  authPassword.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (authMode === "register") {
      await submitRegister();
      return;
    }
    await submitLogin();
  });

  setAuthMode("login");

  avatarButton.addEventListener("click", () => {
    toggleProfileMenu();
  });

  openProfileButton.addEventListener("click", () => {
    closeProfileMenu();
    openProfileView();
  });

  changePhotoButton.addEventListener("click", () => {
    changePhotoInput.click();
  });

  changePhotoInput.addEventListener("change", async () => {
    if (!sessionState.currentUser?.name) {
      return;
    }

    const file = changePhotoInput.files && changePhotoInput.files[0] ? changePhotoInput.files[0] : null;

    if (!file) {
      return;
    }

    try {
      const photoDataUrl = await readFileAsDataUrl(file);
      const updatedUser = await apiUpdatePhoto(sessionState.currentUser.name, photoDataUrl);
      setCurrentUser(updatedUser);
      await refreshActiveUsersNow();
      closeProfileMenu();
      showReviewStatus("Foto de perfil actualizada.");
    } catch (error) {
      showReviewStatus(error instanceof Error ? error.message : "No se pudo actualizar la foto.");
    }

    changePhotoInput.value = "";
  });

  viewReviewsButton.addEventListener("click", async () => {
    closeProfileMenu();
    await openMyReviewsView();
  });

  const partyRecordsBackButton = document.getElementById("party-records-back");
  if (partyRecordsBackButton) {
    partyRecordsBackButton.addEventListener("click", () => {
      showMainView();
    });
  }

  const openUsersBoardButton = document.getElementById("open-users-board");
  if (openUsersBoardButton) {
    openUsersBoardButton.addEventListener("click", async () => {
      closeProfileMenu();
      await openUsersBoardView();
    });
  }

  const usersBoardBackButton = document.getElementById("users-board-back");
  if (usersBoardBackButton) {
    usersBoardBackButton.addEventListener("click", () => {
      showMainView();
    });
  }

  const openMyPartiesButton = document.getElementById("open-my-parties");
  if (openMyPartiesButton) {
    openMyPartiesButton.addEventListener("click", async () => {
      closeProfileMenu();
      await openMyPartiesView();
    });
  }

  const myPartiesBackButton = document.getElementById("my-parties-back");
  if (myPartiesBackButton) {
    myPartiesBackButton.addEventListener("click", () => {
      showMainView();
    });
  }

  const partyBriefCloseButton = document.getElementById("party-brief-close");
  if (partyBriefCloseButton) {
    partyBriefCloseButton.addEventListener("click", () => {
      hidePartyBriefPopup();
    });
  }

  const topAlbumInputs = [
    profileTopAlbum1,
    profileTopAlbum1Artist,
    profileTopAlbum2,
    profileTopAlbum2Artist,
    profileTopAlbum3,
    profileTopAlbum3Artist
  ];

  topAlbumInputs.forEach((input) => {
    input.addEventListener("input", () => {
      refreshProfileTopAlbumPreviews();
    });
  });

  saveProfileButton.addEventListener("click", async () => {
    if (!sessionState.currentUser?.name) {
      profileSaveStatus.textContent = "Inicia sesion para editar tu perfil.";
      return;
    }

    const description = normalizeProfileDescription(profileDescription.value || "");
    const instagramUsername = normalizeInstagramHandle(profileInstagram.value || "");
    const spotifyUrl = normalizeSpotifyUrl(profileSpotify?.value || "");

    if (!isValidSpotifyUrl(spotifyUrl)) {
      if (profileSpotifyError) {
        profileSpotifyError.textContent = "El link debe empezar con https://open.spotify.com/user/";
        profileSpotifyError.hidden = false;
      }
      profileSpotify?.focus();
      return;
    }
    if (profileSpotifyError) profileSpotifyError.hidden = true;

    const previousTopAlbums = getTopAlbumsFromUser(sessionState.currentUser);
    const topAlbums = normalizeTopAlbums([
      {
        title: profileTopAlbum1.value,
        artist: profileTopAlbum1Artist.value,
        coverUrl: topAlbumCoverUserPick.get(getTopAlbumCoverCacheKey(profileTopAlbum1.value, profileTopAlbum1Artist.value)) || ""
      },
      {
        title: profileTopAlbum2.value,
        artist: profileTopAlbum2Artist.value,
        coverUrl: topAlbumCoverUserPick.get(getTopAlbumCoverCacheKey(profileTopAlbum2.value, profileTopAlbum2Artist.value)) || ""
      },
      {
        title: profileTopAlbum3.value,
        artist: profileTopAlbum3Artist.value,
        coverUrl: topAlbumCoverUserPick.get(getTopAlbumCoverCacheKey(profileTopAlbum3.value, profileTopAlbum3Artist.value)) || ""
      }
    ]);

    try {
      profileSaveStatus.textContent = "Guardando...";
      const updatedUser = await apiUpdateProfile(sessionState.currentUser.name, description, instagramUsername, spotifyUrl, topAlbums);
      previousTopAlbums.forEach((entry) => {
        clearTopAlbumCoverCacheEntry(entry.title, entry.artist);
      });
      topAlbums.forEach((entry) => {
        clearTopAlbumCoverCacheEntry(entry.title, entry.artist);
      });
      setCurrentUser(updatedUser);
      refreshProfileTopAlbumPreviews();
      await refreshActiveUsersNow();
      profileSaveStatus.textContent = "Perfil guardado correctamente.";
      showReviewStatus("Perfil guardado correctamente.");
    } catch (error) {
      profileSaveStatus.textContent = error instanceof Error ? error.message : "No se pudo guardar el perfil.";
    }
  });

  logoutButton.addEventListener("click", async () => {
    await logoutUser();
  });

  reviewsBackButton.addEventListener("click", () => {
    if (viewBeforeReviews === "profile") {
      openProfileView();
      return;
    }

    showMainView();
  });

  profileBackButton.addEventListener("click", () => {
    showMainView();
  });

  document.addEventListener("click", handleTopAlbumPickerClick);

  document.addEventListener("click", (event) => {
    const target = event.target;
    const menu = document.getElementById("profile-menu");
    const hub = document.getElementById("profile-hub");

    if (!menu || !hub || menu.hidden) {
      return;
    }

    if (hub.contains(target)) {
      return;
    }

    closeProfileMenu();
  });
}

let gravityDropActive = false;

async function openAddAlbumModal() {
  const overlay = document.getElementById("add-album-overlay");
  if (overlay) overlay.hidden = false;
  const titleInput = document.getElementById("add-album-title");
  const artistInput = document.getElementById("add-album-artist");
  const ownerInput = document.getElementById("add-album-owner");
  const statusEl = document.getElementById("add-album-status");
  const picker = document.getElementById("add-album-picker");
  const preview = document.getElementById("add-album-cover-preview");
  const emptyLabel = document.getElementById("add-album-cover-empty");
  const suggestions = document.getElementById("add-album-owner-suggestions");
  if (titleInput) titleInput.value = "";
  if (artistInput) artistInput.value = "";
  if (ownerInput) ownerInput.value = "";
  if (statusEl) statusEl.textContent = "";
  if (picker) picker.innerHTML = "";
  if (preview) { preview.hidden = true; preview.src = ""; }
  if (emptyLabel) emptyLabel.textContent = "Sin portada";
  if (suggestions) suggestions.hidden = true;
  const cameraInput = document.getElementById("add-album-camera-input");
  if (cameraInput) cameraInput.value = "";
  addAlbumModalState.coverOptions = [];
  addAlbumModalState.selectedUrl = "";
  addAlbumModalState.users = [];
  if (titleInput) titleInput.focus();

  try {
    addAlbumModalState.users = await apiGetUsersBoard();
  } catch {
    // silently ignore — validation will catch it if needed
  }
}

function closeAddAlbumModal() {
  const overlay = document.getElementById("add-album-overlay");
  if (overlay) overlay.hidden = true;
  clearTimeout(addAlbumSearchTimer);
}

function renderAddAlbumModalPicker() {
  const picker = document.getElementById("add-album-picker");
  const preview = document.getElementById("add-album-cover-preview");
  const emptyLabel = document.getElementById("add-album-cover-empty");
  if (!picker) return;

  const options = addAlbumModalState.coverOptions;

  if (!addAlbumModalState.selectedUrl && options.length) {
    addAlbumModalState.selectedUrl = options[0].url;
    if (preview) { preview.src = options[0].url; preview.hidden = false; }
    if (emptyLabel) emptyLabel.textContent = "";
  }

  picker.innerHTML = options.map((opt) => {
    const isSelected = opt.url === addAlbumModalState.selectedUrl;
    const label = [opt.collectionName, opt.artistName].filter(Boolean).join(" – ");
    return `<button type="button" class="add-album-picker-btn ${isSelected ? "selected" : ""}" data-url="${escapeHtml(opt.url)}" title="${escapeHtml(label)}"><img src="${escapeHtml(opt.url)}" alt="${escapeHtml(label)}" loading="lazy" onerror="this.closest('button').style.display='none'" /></button>`;
  }).join("");
}

function showOwnerSuggestions(query) {
  const suggestions = document.getElementById("add-album-owner-suggestions");
  if (!suggestions) return;

  const q = query.trim().toLowerCase();
  const matches = q
    ? addAlbumModalState.users.filter((u) =>
        String(u.name || "").toLowerCase().includes(q)
      )
    : addAlbumModalState.users;

  if (!matches.length) {
    suggestions.hidden = true;
    return;
  }

  suggestions.innerHTML = matches.map((u) => {
    const safeName = escapeHtml(String(u.name || ""));
    const photoUrl = String(u.photoDataUrl || "").trim();
    const avatarMarkup = photoUrl
      ? `<img class="add-album-suggestion-avatar" src="${escapeHtml(photoUrl)}" alt="" />`
      : `<span class="add-album-suggestion-letter">${escapeHtml(safeName[0] || "?")}</span>`;
    return `<li class="add-album-suggestion-item" data-name="${safeName}">${avatarMarkup}${safeName}</li>`;
  }).join("");

  suggestions.hidden = false;
}

function hideOwnerSuggestions() {
  const suggestions = document.getElementById("add-album-owner-suggestions");
  if (suggestions) suggestions.hidden = true;
}

async function triggerAddAlbumCoverSearch() {
  const title = document.getElementById("add-album-title")?.value.trim() || "";
  const artist = document.getElementById("add-album-artist")?.value.trim() || "";
  const picker = document.getElementById("add-album-picker");
  const preview = document.getElementById("add-album-cover-preview");
  const emptyLabel = document.getElementById("add-album-cover-empty");

  if (!title && !artist) {
    addAlbumModalState.coverOptions = [];
    addAlbumModalState.selectedUrl = "";
    if (picker) picker.innerHTML = "";
    if (preview) { preview.hidden = true; preview.src = ""; }
    if (emptyLabel) emptyLabel.textContent = "Sin portada";
    return;
  }

  if (emptyLabel) emptyLabel.textContent = "Buscando portada...";
  if (picker) picker.innerHTML = "";
  if (preview) { preview.hidden = true; preview.src = ""; }

  try {
    const options = await fetchTopAlbumCover(title, artist);
    addAlbumModalState.coverOptions = options || [];
    addAlbumModalState.selectedUrl = "";
    renderAddAlbumModalPicker();
    if (!options.length && emptyLabel) emptyLabel.textContent = "Sin portada";
  } catch {
    if (emptyLabel) emptyLabel.textContent = "Sin portada";
  }
}

async function fetchTracksForAlbum(title, artist) {
  const query = [artist, title].filter(Boolean).join(" ");
  try {
    const searchRes = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=5`
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const found = (searchData?.results || []).find(r => r.collectionId) || searchData?.results?.[0];
    if (!found?.collectionId) return [];
    const tracksRes = await fetch(
      `https://itunes.apple.com/lookup?id=${found.collectionId}&entity=song`
    );
    if (!tracksRes.ok) return [];
    const tracksData = await tracksRes.json();
    return (tracksData?.results || [])
      .filter(r => r.wrapperType === "track")
      .sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber))
      .map(r => String(r.trackName || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function saveAddAlbum() {
  const title = document.getElementById("add-album-title")?.value.trim() || "";
  const artist = document.getElementById("add-album-artist")?.value.trim() || "";
  const owner = document.getElementById("add-album-owner")?.value.trim() || "";
  const statusEl = document.getElementById("add-album-status");
  const coverUrl = addAlbumModalState.selectedUrl || coverFallbackUrl;

  if (!title || !artist) {
    if (statusEl) statusEl.textContent = "Falta el nombre del album o artista.";
    return;
  }

  let ownerPhotoUrl = "";
  if (owner) {
    const ownerUser = addAlbumModalState.users.find(
      (u) => String(u.name || "").toLowerCase() === owner.toLowerCase()
    );
    if (!ownerUser) {
      if (statusEl) statusEl.textContent = "El usuario no existe. Selecciona uno de la lista.";
      const ownerInput = document.getElementById("add-album-owner");
      if (ownerInput) ownerInput.focus();
      return;
    }
    ownerPhotoUrl = ownerUser.photoDataUrl || "";
  }

  const spotifyQuery = [artist, title].filter(Boolean).join(" ");
  const album = {
    id: `custom-${Date.now()}`,
    title,
    artist,
    year: new Date().getFullYear().toString(),
    dateAdded: new Date().toISOString(),
    score: 0,
    genre: "",
    primaryGenre: "Unknown",
    notes: "",
    releaseUrl: "",
    spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}`,
    coverUrl,
    vinylColor: "#0b0b0b",
    vinylColorSecondary: "",
    discType: "vinyl",
    discCount: 1,
    isClearVinyl: false,
    tracks: [],
    details: [],
    ownedByUser: true,
    giftedBy: "",
    owner,
    ownerPhotoUrl,
    isLive: true
  };

  appState.albums.unshift(album);
  renderAlbums();
  renderProfileAlbums();
  closeAddAlbumModal();

  try {
    await apiAddLiveAlbum({
      id: album.id,
      title: album.title,
      artist: album.artist,
      owner: album.owner,
      ownerPhotoUrl: album.ownerPhotoUrl,
      coverUrl: album.coverUrl,
      spotifyUrl: album.spotifyUrl
    });
  } catch (err) {
    console.error("Error saving live album:", err);
  }

  // Fetch tracks in background and update the album card
  fetchTracksForAlbum(title, artist).then((tracks) => {
    if (!tracks.length) return;
    const stored = appState.albums.find((a) => a.id === album.id);
    if (stored) {
      stored.tracks = tracks;
      renderAlbums();
    }
  }).catch(() => {});
}

function setupAddAlbumModal() {
  const fab = document.getElementById("add-album-button");
  const cancelBtn = document.getElementById("add-album-cancel");
  const saveBtn = document.getElementById("add-album-save");
  const titleInput = document.getElementById("add-album-title");
  const artistInput = document.getElementById("add-album-artist");
  const ownerInput = document.getElementById("add-album-owner");
  const picker = document.getElementById("add-album-picker");
  const suggestions = document.getElementById("add-album-owner-suggestions");
  const cameraBtn = document.getElementById("add-album-camera-btn");
  const cameraInput = document.getElementById("add-album-camera-input");

  if (fab) fab.addEventListener("click", () => openAddAlbumModal());
  if (cancelBtn) cancelBtn.addEventListener("click", () => closeAddAlbumModal());
  if (saveBtn) saveBtn.addEventListener("click", () => saveAddAlbum());

  if (cameraBtn && cameraInput) {
    cameraBtn.addEventListener("click", () => cameraInput.click());
    cameraInput.addEventListener("change", async () => {
      const file = cameraInput.files && cameraInput.files[0] ? cameraInput.files[0] : null;
      if (!file) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        addAlbumModalState.selectedUrl = dataUrl;
        const preview = document.getElementById("add-album-cover-preview");
        const emptyLabel = document.getElementById("add-album-cover-empty");
        if (preview) { preview.src = dataUrl; preview.hidden = false; }
        if (emptyLabel) emptyLabel.textContent = "";
        // Clear picker selection since camera photo takes precedence
        const pickerEl = document.getElementById("add-album-picker");
        if (pickerEl) pickerEl.querySelectorAll(".add-album-picker-btn").forEach((b) => b.classList.remove("selected"));
      } catch {
        const statusEl = document.getElementById("add-album-status");
        if (statusEl) statusEl.textContent = "No se pudo leer la foto.";
      }
      cameraInput.value = "";
    });
  }

  [titleInput, artistInput].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", () => {
      clearTimeout(addAlbumSearchTimer);
      addAlbumSearchTimer = setTimeout(() => triggerAddAlbumCoverSearch(), 600);
    });
  });

  if (ownerInput) {
    ownerInput.addEventListener("input", () => {
      showOwnerSuggestions(ownerInput.value);
    });
    ownerInput.addEventListener("focus", () => {
      showOwnerSuggestions(ownerInput.value);
    });
    ownerInput.addEventListener("blur", () => {
      // Delay so a click on a suggestion registers first
      setTimeout(() => hideOwnerSuggestions(), 180);
    });
  }

  if (suggestions) {
    suggestions.addEventListener("mousedown", (e) => {
      const item = e.target.closest(".add-album-suggestion-item");
      if (!item) return;
      e.preventDefault(); // prevent input blur before click fires
      if (ownerInput) ownerInput.value = item.dataset.name;
      hideOwnerSuggestions();
    });
  }

  if (picker) {
    picker.addEventListener("click", (e) => {
      const btn = e.target.closest(".add-album-picker-btn");
      if (!btn) return;
      addAlbumModalState.selectedUrl = btn.dataset.url;
      const preview = document.getElementById("add-album-cover-preview");
      const emptyLabel = document.getElementById("add-album-cover-empty");
      if (preview) { preview.src = btn.dataset.url; preview.hidden = false; }
      if (emptyLabel) emptyLabel.textContent = "";
      renderAddAlbumModalPicker();
    });
  }
}

function setupLogoGravity() {
  const logoWrap = document.querySelector(".main-logo-wrap");
  if (!logoWrap) return;

  logoWrap.addEventListener("click", () => {
    if (gravityDropActive) return;
    gravityDropActive = true;

    const credit = document.querySelector(".page-credit");
    if (credit) {
      credit.classList.add("visible");
      setTimeout(() => credit.classList.remove("visible"), 3000);
    }

    // Pause physics so bubbles stay put while the CSS transition runs
    if (physicsRafId) {
      cancelAnimationFrame(physicsRafId);
      physicsRafId = null;
    }

    const albumsEl = document.getElementById("albums");
    const bubbleLayerEl = document.getElementById("bubble-layer");
    const userLayerEl = document.getElementById("active-users-layer");

    const targets = [];

    if (albumsEl) {
      for (const card of albumsEl.querySelectorAll(".album-card, .group-pile-wrap")) {
        targets.push(card);
      }
    }
    for (const layer of [bubbleLayerEl, userLayerEl]) {
      if (!layer) continue;
      for (const bubble of layer.querySelectorAll(".review-bubble, .active-user-bubble")) {
        targets.push(bubble);
      }
    }

    // Compute per-element fall distance so they land at the visible bottom
    const vhBottom = window.innerHeight;
    targets.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const pileOffset = Math.floor(Math.random() * 48); // depth in the pile
      const deltaY = vhBottom - rect.bottom - pileOffset;
      const rot = (Math.random() * 28 - 14).toFixed(1);
      const delay = Math.floor(Math.random() * 180);
      el.dataset.gravityDeltaY = String(deltaY);
      el.style.transition = `transform 0.6s cubic-bezier(0.42,0,0.6,1) ${delay}ms`;
      el.style.transform = `translateY(${deltaY}px) rotate(${rot}deg)`;
      el.style.pointerEvents = "none";
    });

    setTimeout(() => {
      // Rise back to original positions
      targets.forEach((el) => {
        el.style.transition = "transform 0.65s cubic-bezier(0.22,0.84,0.28,1)";
        el.style.transform = "";
      });

      setTimeout(() => {
        targets.forEach((el) => {
          el.style.transition = "";
          el.style.transform = "";
          el.style.pointerEvents = "";
          delete el.dataset.gravityDeltaY;
        });
        gravityDropActive = false;
        startPhysicsLoop();
      }, 700);
    }, 3000);
  });
}

async function bootSession() {
  try {
    const sessionUser = await apiGetCurrentUser();
    if (sessionUser) {
      setCurrentUser(sessionUser);
      return;
    }
  } catch {
    // If session check fails, fallback to login form.
  }

  const savedName = getPersistedUserName();
  const authName = document.getElementById("auth-name");
  if (authName && savedName) {
    authName.value = savedName;
  }

  showAuthOverlay("Inicia sesion o crea un usuario.");
}

(function restrictAccess() {
  const isMobileDevice =
    /Android.+Mobile|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes("iPad") && navigator.maxTouchPoints > 1);
  const host = window.location.hostname;
  const isPrivateIpv4 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const isLocal = localHosts.has(host) || isPrivateIpv4;
  const title = document.getElementById("title");
  const message = document.getElementById("message");

  if (!isMobileDevice || !isLocal) {
    if (title) {
      title.hidden = false;
      title.textContent = "Acceso restringido";
    }
    if (message) {
      message.textContent = "Esta pagina solo esta disponible en telefonos desde una direccion local.";
    }
    const albums = document.getElementById("albums");
    if (albums) {
      albums.innerHTML = "";
    }
    hideNowPlaying();
    hideAuthOverlay();
    return;
  }

  if (message) {
    message.hidden = true;
  }

  setupAlbumInteractions();
  setupAlbumSortControls();
  setupAlbumSearchBar();
  setupNowPlayingInteractions();
  setupBubbleInteractions();
  setupActiveUserBubbleInteractions();
  setupBubbleOutsideClickHandler();
  setupPartyPictureLightboxInteractions();
  setupAuthInteractions();
  setupAddAlbumModal();
  setupLogoGravity();
  startNowPlayingPolling();
  startReviewPolling();
  startActiveUsersPolling();
  startLiveAlbumsPolling();
  void bootSession();

  loadAlbums()
    .then(async (albumDatabase) => {
      appState.albums = Array.isArray(albumDatabase) ? albumDatabase : (albumDatabase.albums || []);
      sortAlbumsInState();
      try { mergeLiveAlbums(await apiGetLiveAlbums()); } catch { /* ignore */ }
      renderAlbums();
    })
    .catch(() => {
      if (message) {
        message.textContent = "No se pudieron cargar los datos de los albumes.";
      }
      const albums = document.getElementById("albums");
      if (albums) {
        albums.innerHTML = "";
      }
    });
})();
