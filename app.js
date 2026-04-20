const appState = {
  albums: [],
  expandedAlbumId: null
};

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
const userPhotoCache = new Map();

function normalizeTrackLabel(value) {
  const text = String(value || "").trim();
  return text.replace(/^[A-Z]{1,3}\d+[A-Z]?\s*-\s*/i, "");
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

async function apiLogin(name) {
  const response = await fetch("/api/users/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name })
  });

  if (response.status === 404) {
    throw new Error("Ese nombre no existe. Crea el usuario primero.");
  }

  if (!response.ok) {
    throw new Error("No se pudo iniciar sesion.");
  }

  const payload = await response.json();
  return payload.user || null;
}

async function apiRegister(name, photoDataUrl) {
  const response = await fetch("/api/users/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
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

function getProfilePhotoUrl(user) {
  const photo = String(user?.photoDataUrl || "").trim();
  return photo || coverFallbackUrl;
}

function setCurrentUser(user) {
  sessionState.currentUser = user || null;
  const profileHub = document.getElementById("profile-hub");
  const profileAvatar = document.getElementById("profile-avatar");
  const profileMenuUser = document.getElementById("profile-menu-user");
  const reviewerName = document.getElementById("reviewer-name");

  if (!sessionState.currentUser) {
    clearPersistedUserName();
    if (profileHub) {
      profileHub.hidden = true;
    }
    if (reviewerName) {
      reviewerName.value = "";
    }
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

  if (reviewerName) {
    reviewerName.value = sessionState.currentUser.name || "";
  }

  hideAuthOverlay();
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

  if (mainView) {
    mainView.hidden = false;
  }

  if (reviewsView) {
    reviewsView.hidden = true;
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

    if (mainView) {
      mainView.hidden = true;
    }

    if (reviewsView) {
      reviewsView.hidden = false;
    }
  } catch (error) {
    showReviewStatus(error instanceof Error ? error.message : "No se pudieron cargar tus reseñas.");
  }
}

function logoutUser() {
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
      const isExpanded = appState.expandedAlbumId === album.id;
      const safeTitle = escapeHtml(album.title);
      const safeArtist = escapeHtml(album.artist);
      const safeYear = escapeHtml(album.year);
      const safeGenre = escapeHtml(album.genre);
      const safeNotes = escapeHtml(album.notes);
      const safeGiftedBy = escapeHtml(album.giftedBy || "");
      const safeCoverUrl = escapeHtml(album.coverUrl);
      const coverClassName = album.ownedByUser ? "" : "not-owned";
      const detailListMarkup = (album.details || [])
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("");
      const spotifyButtonMarkup = album.spotifyUrl
        ? `<a class="album-action-button" href="${escapeHtml(album.spotifyUrl)}" target="_blank" rel="noreferrer">Abrir en Spotify</a>`
        : "";
      const linksMarkup = spotifyButtonMarkup
        ? `<div class="album-links">${spotifyButtonMarkup}</div>`
        : "";
      const giftedByMarkup = safeGiftedBy
        ? `<p class="gifted-by"><em>Regalado por: ${safeGiftedBy}</em></p>`
        : "";

      return `
        <article class="album-card ${isExpanded ? "expanded" : ""}">
          <button
            type="button"
            class="cover-button"
            data-album-id="${album.id}"
            aria-expanded="${isExpanded}"
            aria-controls="album-details-${album.id}"
          >
            <img class="${coverClassName}" src="${safeCoverUrl}" alt="${safeTitle} album cover" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" />
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

function setupAlbumInteractions() {
  const container = document.getElementById("albums");

  if (!container) {
    return;
  }

  container.addEventListener("click", (event) => {
    const trigger = event.target.closest(".cover-button");

    if (!trigger) {
      return;
    }

    const albumId = trigger.dataset.albumId;
    appState.expandedAlbumId = appState.expandedAlbumId === albumId ? null : albumId;
    renderAlbums();
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

    return {
      id: item.releaseUrl || `${item.title}-${item.artist}-${index}`,
      title: item.title || "Untitled release",
      artist: item.artist || "Unknown artist",
      year: item.year || "Unknown year",
      genre: item.rawText || "Discogs collection item",
      notes: tracks.length ? `${tracks.length} canciones` : `Release page ${item.sourcePage || "?"}`,
      releaseUrl: item.releaseUrl || "",
      spotifyUrl,
      coverUrl: item.imageUrl || coverFallbackUrl,
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

  if (panel) {
    panel.hidden = true;
  }

  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
  }

  if (section) {
    section.hidden = true;
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

  if (!toggle || !panel || !ratingContainer || !saveButton) {
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

  renderRating(selectedRating);
}

function renderNowPlaying(nowPlaying) {
  const section = document.getElementById("now-playing");
  const cover = document.getElementById("now-playing-cover");
  const text = document.getElementById("now-playing-text");
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
  const authPhoto = document.getElementById("auth-photo");
  const loginButton = document.getElementById("auth-login");
  const registerButton = document.getElementById("auth-register");
  const avatarButton = document.getElementById("profile-avatar-button");
  const changePhotoButton = document.getElementById("change-photo");
  const changePhotoInput = document.getElementById("change-photo-input");
  const viewReviewsButton = document.getElementById("view-reviews");
  const logoutButton = document.getElementById("logout-profile");
  const reviewsBackButton = document.getElementById("reviews-back");

  if (!authName || !authPhoto || !loginButton || !registerButton || !avatarButton || !changePhotoButton || !changePhotoInput || !viewReviewsButton || !logoutButton || !reviewsBackButton) {
    return;
  }

  loginButton.addEventListener("click", async () => {
    const name = normalizeUserName(authName.value);

    if (!name) {
      setAuthStatus("Escribe tu nombre.");
      return;
    }

    try {
      setAuthStatus("Entrando...");
      const user = await apiLogin(name);
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

    if (!name) {
      setAuthStatus("Escribe un nombre para crear el usuario.");
      return;
    }

    try {
      setAuthStatus("Creando usuario...");
      const file = authPhoto.files && authPhoto.files[0] ? authPhoto.files[0] : null;
      const photoDataUrl = file ? await readFileAsDataUrl(file) : "";
      const user = await apiRegister(name, photoDataUrl);
      if (!user) {
        throw new Error("No se pudo crear el perfil.");
      }
      setCurrentUser(user);
      authPhoto.value = "";
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

  avatarButton.addEventListener("click", () => {
    toggleProfileMenu();
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

  logoutButton.addEventListener("click", () => {
    logoutUser();
  });

  reviewsBackButton.addEventListener("click", () => {
    showMainView();
  });

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
  const savedName = getPersistedUserName();

  if (!savedName) {
    showAuthOverlay("Inicia sesion o crea un usuario.");
    return;
  }

  try {
    const user = await apiGetUser(savedName);
    if (!user) {
      showAuthOverlay("Inicia sesion o crea un usuario.");
      clearPersistedUserName();
      return;
    }

    setCurrentUser(user);
  } catch {
    showAuthOverlay("Inicia sesion o crea un usuario.");
  }
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
  setupNowPlayingInteractions();
  setupBubbleInteractions();
  setupAuthInteractions();
  startNowPlayingPolling();
  void bootSession();

  loadAlbums()
    .then((albumDatabase) => {
      appState.albums = Array.isArray(albumDatabase) ? albumDatabase : (albumDatabase.albums || []);
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
