const appState = {
  albums: [],
  expandedAlbumId: null,
  sortBy: "date",
  sortDirection: "desc"
};

let pendingAlbumOpenAnimationId = null;

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
  { key: "grape", color: "#7e22ce" },
  { key: "coral", color: "#fb7185" },
  { key: "green", color: "#16a34a" },
  { key: "red", color: "#dc2626" },
  { key: "blue", color: "#2563eb" },
  { key: "yellow", color: "#eab308" },
  { key: "orange", color: "#f97316" },
  { key: "pink", color: "#ec4899" },
  { key: "purple", color: "#8b5cf6" },
  { key: "white", color: "#f8fafc" },
  { key: "gold", color: "#ca8a04" },
  { key: "silver", color: "#94a3b8" }
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

function detectVinylColors(rawText) {
  const text = String(rawText || "").toLowerCase();

  if (!text) {
    return ["#0b0b0b", ""];
  }

  const translucent = /(translucent|transparent|clear)/.test(text);
  const clearOnly = /\bclear\b/.test(text);
  const matchedRules = VINYL_COLOR_RULES.filter((rule) => text.includes(rule.key));

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
  if (!text) {
    return "vinyl";
  }

  if (/\bcd\b|compact\s*disc|cdr|cd-r/.test(text)) {
    return "cd";
  }

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

async function apiUpdateProfile(name, description, instagramUsername, topAlbums) {
  const response = await fetch("/api/users/profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      description,
      instagramUsername,
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

function normalizeTopAlbums(topAlbums) {
  const source = Array.isArray(topAlbums) ? topAlbums : [];
  const normalized = source
    .slice(0, 3)
    .map((value) => {
      if (value && typeof value === "object") {
        return {
          title: String(value.title || "").trim().slice(0, 150),
          artist: String(value.artist || "").trim().slice(0, 120)
        };
      }

      return {
        title: String(value || "").trim().slice(0, 150),
        artist: ""
      };
    });

  while (normalized.length < 3) {
    normalized.push({
      title: "",
      artist: ""
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

  if (!title && !artist) {
    return [];
  }

  function norm(s) {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function artworkUrl(result) {
    const url = String(result?.artworkUrl100 || result?.artworkUrl60 || "").trim();
    return url ? url.replace(/100x100bb|60x60bb/, "600x600bb") : "";
  }

  async function fetchRaw(query) {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=10`);
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  function dedup(rawResults) {
    const seen = new Set();
    const options = [];
    for (const r of rawResults) {
      const url = artworkUrl(r);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      options.push({ url, collectionName: r.collectionName || "", artistName: r.artistName || "" });
    }
    return options;
  }

  try {
    const normTitle = norm(title);
    const normArtist = norm(artist);

    // Try combined query first; fall back to artist-only if it returns nothing useful
    const combinedQuery = [artist, title].filter(Boolean).join(" ");
    let raw = await fetchRaw(combinedQuery);

    if (!raw.length && artist) {
      raw = await fetchRaw(artist);
    }

    const options = dedup(raw);
    if (!options.length) return [];

    options.sort((a, b) => {
      function score(o) {
        const t = norm(o.collectionName);
        const ar = norm(o.artistName);
        const titleMatch = t === normTitle || t.includes(normTitle) || normTitle.includes(t);
        const artistMatch = ar === normArtist || ar.includes(normArtist) || normArtist.includes(ar);
        if (titleMatch && artistMatch) return 0;
        if (titleMatch) return 1;
        if (artistMatch) return 2;
        return 3;
      }
      return score(a) - score(b);
    });

    return options;
  } catch {
    return [];
  }
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
    return `<button type="button" class="${isSelected ? "selected" : ""}" title="${escapeHtml(label)}" data-url="${escapeHtml(opt.url)}" data-index="${index}" data-title="${escapeHtml(albumTitle)}" data-artist="${escapeHtml(albumArtist)}"><img src="${escapeHtml(opt.url)}" alt="${escapeHtml(label)}" loading="lazy" /></button>`;
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
      const topAlbums = getTopAlbumsFromUser(user).filter((entry) => entry.title);
      const defaultLeft = 4 + ((index * 17) % 88);
      const defaultTop = 10 + ((index * 23) % 80);
      const left = savedState?.left ?? defaultLeft;
      const top = savedState?.top ?? defaultTop;
      const delay = (index % 5) * -1.25;
      const duration = 14 + (index % 6) * 2;
      const driftX = 14 + (index % 7) * 5;
      const driftY = -10 - (index % 5) * 4;
      const descriptionMarkup = description
        ? `<p class="active-user-detail-value">${description}</p>`
        : `<p class="active-user-detail-value active-user-detail-empty">Sin descripcion.</p>`;
      const instagramMarkup = instagram
        ? `<p class="active-user-detail-value"><button type="button" class="active-user-instagram-link" data-instagram="${instagram}">@${instagram}</button></p>`
        : `<p class="active-user-detail-value active-user-detail-empty">Sin Instagram.</p>`;
      const topAlbumsMarkup = topAlbums.length
        ? topAlbums
            .map((entry) => {
              const safeAlbumTitle = escapeHtml(entry.title);
              const safeAlbumArtist = escapeHtml(entry.artist || "");
              const displayText = safeAlbumArtist
                ? `${safeAlbumTitle} - ${safeAlbumArtist}`
                : safeAlbumTitle;
              const coverUrl = ensureTopAlbumCover(entry.title, entry.artist);
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
        <article class="active-user-bubble ${expanded ? "expanded" : ""}" data-user-key="${encodedUserKey}" title="${safeName}" style="left:${left}%;top:${top}%;--delay:${delay}s;--duration:${duration}s;--drift-x:${driftX}px;--drift-y:${driftY}px;">
          ${hasPhoto
            ? `<img src="${safePhotoUrl}" alt="Foto de ${safeName}" loading="lazy" />`
            : `<span class="active-user-letter" style="background:${color};">${letter}</span>`}
          <div class="active-user-bubble-details">
            <p class="active-user-detail-name">${safeName}</p>
            <p class="active-user-detail-label">Descripcion</p>
            ${descriptionMarkup}
            <p class="active-user-detail-label">Instagram</p>
            ${instagramMarkup}
            <p class="active-user-detail-label">Top albums</p>
            <ul class="active-user-top-albums-list">${topAlbumsMarkup}</ul>
          </div>
        </article>
      `;
    })
    .join("");

  lastActiveUsersSignature = signature;
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

  if (profileDescription) {
    profileDescription.value = String(sessionState.currentUser.description || "").trim();
  }

  if (profileInstagram) {
    profileInstagram.value = String(sessionState.currentUser.instagramUsername || "").trim();
  }

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

  await apiSetNowPlaying({
    actorName: sessionState.currentUser.name,
    albumTitle: album.title,
    albumArtist: album.artist,
    songTitle: "",
    reviewScope: "album",
    coverUrl: album.coverUrl
  });
  showReviewStatus(`Escucha iniciada para album: ${album.title}`);
}

async function startSongListening(album, songTitle) {
  if (!album || !songTitle || !isAdminUser() || !sessionState.currentUser?.name) {
    return;
  }

  await apiSetNowPlaying({
    actorName: sessionState.currentUser.name,
    albumTitle: album.title,
    albumArtist: album.artist,
    songTitle,
    reviewScope: "song",
    coverUrl: album.coverUrl
  });
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

  if (mainView) {
    mainView.hidden = false;
  }

  if (reviewsView) {
    reviewsView.hidden = true;
  }

  if (profileView) {
    profileView.hidden = true;
  }
}

function openProfileView() {
  const mainView = document.getElementById("main-view");
  const reviewsView = document.getElementById("reviews-view");
  const profileView = document.getElementById("profile-view");

  if (mainView) {
    mainView.hidden = true;
  }

  if (reviewsView) {
    reviewsView.hidden = true;
  }

  if (profileView) {
    profileView.hidden = false;
  }
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

    viewBeforeReviews = profileView && !profileView.hidden ? "profile" : "main";

    if (mainView) {
      mainView.hidden = true;
    }

    if (profileView) {
      profileView.hidden = true;
    }

    if (reviewsView) {
      reviewsView.hidden = false;
    }
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

function renderAlbums() {
  const container = document.getElementById("albums");

  if (!container) {
    return;
  }

  if (!appState.albums.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = appState.albums
    .map((album) => {
      const adminUser = isAdminUser();
      const isExpanded = appState.expandedAlbumId === album.id;
      const safeTitle = escapeHtml(album.title);
      const safeArtist = escapeHtml(album.artist);
      const safeYear = escapeHtml(album.year);
      const safeGenre = escapeHtml(album.genre);
      const safeNotes = escapeHtml(album.notes);
      const safeGiftedBy = escapeHtml(album.giftedBy || "");
      const safeCoverUrl = escapeHtml(album.coverUrl);
      const safeVinylColor = escapeHtml(album.vinylColor || "#0b0b0b");
      const safeVinylColorSecondary = escapeHtml(album.vinylColorSecondary || "");
      const secondaryVinylColor = safeVinylColorSecondary || safeVinylColor;
      const isCdDisc = album.discType === "cd";
      const hasSecondDisc = !isCdDisc && (Boolean(safeVinylColorSecondary) || Number(album.discCount || 1) > 1);
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
              ${hasSecondDisc ? `<span class="vinyl-disc vinyl-disc-secondary ${clearVinylClass}" style="--vinyl-color:${secondaryVinylColor}"></span>` : ""}
            </span>
          </button>
          <div id="album-details-${album.id}" class="album-details">
            <h2>${safeTitle}</h2>
            <p class="meta">${safeArtist} - ${safeYear}</p>
            <p class="meta">${safeGenre}</p>
            <p class="notes">${safeNotes}</p>
            ${giftedByMarkup}
            ${linksMarkup}
            <ol class="track-list">${detailListMarkup}</ol>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateSortDirectionButtonLabel() {
  const directionButton = document.getElementById("album-sort-direction");
  if (!directionButton) {
    return;
  }

  directionButton.textContent = appState.sortDirection === "asc" ? "Ascendente" : "Descendente";
}

function setupAlbumSortControls() {
  const sortBySelect = document.getElementById("album-sort-by");
  const directionButton = document.getElementById("album-sort-direction");

  if (!sortBySelect || !directionButton) {
    return;
  }

  sortBySelect.value = appState.sortBy;
  updateSortDirectionButtonLabel();

  const applySortBySelection = () => {
    const selected = String(sortBySelect.value || "date");
    appState.sortBy = ["date", "score", "artist", "title"].includes(selected) ? selected : "date";
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

      try {
        await startSongListening(album, songTitle);
      } catch (error) {
        showReviewStatus(error instanceof Error ? error.message : "No se pudo iniciar la escucha de la cancion.");
      }
      return;
    }

    const trigger = event.target.closest(".cover-button");

    if (!trigger) {
      return;
    }

    const albumId = trigger.dataset.albumId;
    const nextExpandedAlbumId = appState.expandedAlbumId === albumId ? null : albumId;
    pendingAlbumOpenAnimationId = nextExpandedAlbumId;
    appState.expandedAlbumId = nextExpandedAlbumId;
    renderAlbums();

    if (pendingAlbumOpenAnimationId) {
      runAlbumOpenAnimation(pendingAlbumOpenAnimationId);
      pendingAlbumOpenAnimationId = null;
    }

    if (appState.expandedAlbumId) {
      const expandedCard = container.querySelector(".album-card.expanded");
      if (expandedCard && typeof expandedCard.scrollIntoView === "function") {
        expandedCard.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
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
      item.title,
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
      dateAdded: item.dateAdded || "",
      score: Number(item.rating || 0),
      genre: item.rawText || "Discogs collection item",
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

  const response = await fetch(`/api/reviews?songKey=${encodeURIComponent(reviewKey)}&t=${Date.now()}`, {
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
      ...songReviews.map((review) => ({ ...review, scope: "song" })),
      ...albumReviews.map((review) => ({ ...review, scope: "album" }))
    ];

    const hydratedReviewItems = await enrichReviewsWithPhotos(reviewItems);

    renderReviewBubbles(hydratedReviewItems, `${songKey}|${albumKey}|${reviewScope}`);
  } catch {
    renderReviewBubbles([], `${songKey}|${albumKey}|${reviewScope}`);
    showReviewStatus("No se pudieron cargar las reseñas.");
  }
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
        reviews: []
      });
    }

    grouped.get(groupKey).reviews.push({
      name: safeName,
      text: review.text || "",
      rating: Number(review.rating || 0),
      createdAt: review.createdAt || "",
      scope,
      photoDataUrl: String(review.photoDataUrl || "").trim()
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

    return {
      reviewerKey: group.reviewerKey,
      scope: group.scope,
      displayName: group.displayName,
      averageRating: average,
      avatarUrl: sortedReviews.find((entry) => entry.photoDataUrl)?.photoDataUrl || "",
      reviews: sortedReviews
    };
  });
}

function renderReviewBubbles(reviews, signature = "") {
  const bubbleLayer = document.getElementById("bubble-layer");
  const reviewsSignature = JSON.stringify(reviews);
  const combinedSignature = `${signature}::${reviewsSignature}`;
  const basePositions = [
    { left: 6, top: 72 },
    { left: 76, top: 70 },
    { left: 8, top: 30 },
    { left: 78, top: 32 },
    { left: 42, top: 86 },
    { left: 2, top: 52 },
    { left: 86, top: 52 },
    { left: 46, top: 14 }
  ];

  if (!bubbleLayer) {
    return;
  }

  if (combinedSignature === lastBubbleSignature) {
    return;
  }

  if (!reviews.length) {
    bubbleLayer.innerHTML = "";
    lastBubbleSignature = combinedSignature;
    return;
  }

  const reviewGroups = groupReviewsByReviewer(reviews).slice(-8);

  bubbleLayer.innerHTML = reviewGroups
    .map((group, index) => {
      const id = group.reviewerKey;
      const encodedId = encodeURIComponent(id);
      const savedState = bubbleUiState.get(id);
      const fallbackPosition = basePositions[index % basePositions.length];
      const left = savedState?.left ?? fallbackPosition.left;
      const top = savedState?.top ?? fallbackPosition.top;
      const expanded = savedState?.expanded ?? false;
      const delay = (index % 5) * -2.1;
      const duration = 18 + (index % 6) * 3;
      const driftX = 22 + (index % 5) * 11;
      const driftY = -16 - (index % 4) * 10;
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

      return `
        <article class="review-bubble ${bubbleClass} ${expanded ? "expanded" : ""}" data-review-id="${encodedId}" style="left:${left}%; top:${top}%; --delay:${delay}s; --duration:${duration}s; --drift-x:${driftX}px; --drift-y:${driftY}px;">
          <div class="review-bubble-summary">
            ${headerMarkup}
          </div>
          <ol class="review-bubble-text review-history-list">${historyMarkup}</ol>
        </article>
      `;
    })
    .join("");

  lastBubbleSignature = combinedSignature;
}

function setupBubbleInteractions() {
  const bubbleLayer = document.getElementById("bubble-layer");

  if (!bubbleLayer) {
    return;
  }

  bubbleLayer.addEventListener("pointerdown", (event) => {
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
      moved: false
    };

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
    const leftPercent = (boundedLeft / layerRect.width) * 100;
    const topPercent = (boundedTop / layerRect.height) * 100;

    activeBubbleDrag.bubble.style.left = `${leftPercent}%`;
    activeBubbleDrag.bubble.style.top = `${topPercent}%`;

    if (activeBubbleDrag.bubbleId) {
      const current = bubbleUiState.get(activeBubbleDrag.bubbleId) || {};
      bubbleUiState.set(activeBubbleDrag.bubbleId, {
        ...current,
        left: leftPercent,
        top: topPercent
      });
    }
  });

  const endDrag = (event) => {
    if (!activeBubbleDrag || activeBubbleDrag.pointerId !== event.pointerId) {
      return;
    }

    const { bubble, bubbleId, moved } = activeBubbleDrag;

    bubble.classList.remove("dragging");
    bubble.releasePointerCapture(event.pointerId);

    if (!moved && bubbleId) {
      const current = bubbleUiState.get(bubbleId) || {};
      const nextExpanded = !current.expanded;
      bubbleUiState.set(bubbleId, {
        ...current,
        expanded: nextExpanded
      });
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
      moved: false
    };

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
    const leftPercent = (boundedLeft / layerRect.width) * 100;
    const topPercent = (boundedTop / layerRect.height) * 100;

    activeUserBubbleDrag.bubble.style.left = `${leftPercent}%`;
    activeUserBubbleDrag.bubble.style.top = `${topPercent}%`;

    if (activeUserBubbleDrag.bubbleId) {
      const current = activeUserBubbleUiState.get(activeUserBubbleDrag.bubbleId) || {};
      activeUserBubbleUiState.set(activeUserBubbleDrag.bubbleId, {
        ...current,
        left: leftPercent,
        top: topPercent
      });
    }
  });

  const endDrag = (event) => {
    if (!activeUserBubbleDrag || activeUserBubbleDrag.pointerId !== event.pointerId) {
      return;
    }

    const { bubble, bubbleId, moved } = activeUserBubbleDrag;

    bubble.classList.remove("dragging");
    bubble.releasePointerCapture(event.pointerId);

    if (!moved && bubbleId) {
      const current = activeUserBubbleUiState.get(bubbleId) || {};
      const nextExpanded = !current.expanded;
      activeUserBubbleUiState.set(bubbleId, {
        ...current,
        expanded: nextExpanded
      });
      bubble.classList.toggle("expanded", nextExpanded);
    }

    activeUserBubbleDrag = null;
  };

  activeUsersLayer.addEventListener("pointerup", endDrag);
  activeUsersLayer.addEventListener("pointercancel", endDrag);
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
    showReviewStatus("Reseña guardada.");
    await fetchCurrentSongReviews();
    resetReviewInputs();
    closeReviewPanel();
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
      showReviewStatus("Solo administrador puede finalizar reproduciendo ahora.");
      return;
    }

    try {
      await apiClearNowPlaying(sessionState.currentUser.name);
      hideNowPlaying();
      showReviewStatus("Reproduciendo ahora finalizado.");
    } catch (error) {
      showReviewStatus(error instanceof Error ? error.message : "No se pudo finalizar reproduciendo ahora.");
    }
  });

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
    section.hidden = false;
    lastNowPlayingSignature = signature;
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

function startNowPlayingPolling() {
  const refresh = () => {
    loadNowPlaying()
      .then((data) => {
        renderNowPlaying(data);
      })
      .catch(() => {
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
  const loginButton = document.getElementById("auth-login");
  const registerButton = document.getElementById("auth-register");
  const avatarButton = document.getElementById("profile-avatar-button");
  const changePhotoButton = document.getElementById("change-photo");
  const changePhotoInput = document.getElementById("change-photo-input");
  const viewReviewsButton = document.getElementById("view-reviews");
  const openProfileButton = document.getElementById("open-profile");
  const profileDescription = document.getElementById("profile-description");
  const profileInstagram = document.getElementById("profile-instagram");
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

  if (!authName || !authPassword || !authPhoto || !loginButton || !registerButton || !avatarButton || !changePhotoButton || !changePhotoInput || !viewReviewsButton || !openProfileButton || !profileDescription || !profileInstagram || !profileTopAlbum1 || !profileTopAlbum1Artist || !profileTopAlbum2 || !profileTopAlbum2Artist || !profileTopAlbum3 || !profileTopAlbum3Artist || !profileTopAlbum1Cover || !profileTopAlbum2Cover || !profileTopAlbum3Cover || !saveProfileButton || !profileSaveStatus || !logoutButton || !reviewsBackButton || !profileBackButton) {
    return;
  }

  loginButton.addEventListener("click", async () => {
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
      setAuthStatus("");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "No se pudo iniciar sesion.");
    }
  });

  registerButton.addEventListener("click", async () => {
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
      authPhoto.value = "";
      authPassword.value = "";
      setAuthStatus("");
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "No se pudo crear el usuario.");
    }
  });

  authName.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    loginButton.click();
  });

  authPassword.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    loginButton.click();
  });

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
    const previousTopAlbums = getTopAlbumsFromUser(sessionState.currentUser);
    const topAlbums = normalizeTopAlbums([
      {
        title: profileTopAlbum1.value,
        artist: profileTopAlbum1Artist.value
      },
      {
        title: profileTopAlbum2.value,
        artist: profileTopAlbum2Artist.value
      },
      {
        title: profileTopAlbum3.value,
        artist: profileTopAlbum3Artist.value
      }
    ]);

    try {
      profileSaveStatus.textContent = "Guardando...";
      const updatedUser = await apiUpdateProfile(sessionState.currentUser.name, description, instagramUsername, topAlbums);
      previousTopAlbums.forEach((entry) => {
        clearTopAlbumCoverCacheEntry(entry.title, entry.artist);
      });
      topAlbums.forEach((entry) => {
        clearTopAlbumCoverCacheEntry(entry.title, entry.artist);
      });
      setCurrentUser(updatedUser);
      refreshProfileTopAlbumPreviews();
      await refreshActiveUsersNow();
      profileSaveStatus.textContent = "Perfil actualizado.";
      showReviewStatus("Perfil actualizado.");
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
    message.textContent = "Toca cualquier album para ver los detalles. Toca de nuevo para contraerlo.";
  }

  setupAlbumInteractions();
  setupAlbumSortControls();
  setupNowPlayingInteractions();
  setupBubbleInteractions();
  setupActiveUserBubbleInteractions();
  setupAuthInteractions();
  startNowPlayingPolling();
  startActiveUsersPolling();
  void bootSession();

  loadAlbums()
    .then((albumDatabase) => {
      appState.albums = Array.isArray(albumDatabase) ? albumDatabase : (albumDatabase.albums || []);
      sortAlbumsInState();
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
