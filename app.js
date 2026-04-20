const appState = {
  albums: [],
  expandedAlbumId: null
};

const coverFallbackUrl = "./mi%20dise%C3%B1o.png";

function normalizeTrackLabel(value) {
  const text = String(value || "").trim();
  return text.replace(/^[A-Z]{1,3}\d+[A-Z]?\s*-\s*/i, "");
}

let lastNowPlayingSignature = "";
let selectedRating = 0;
let currentNowPlaying = null;
const bubbleUiState = new Map();
let activeBubbleDrag = null;
let lastBubbleSongKey = "";
let lastBubbleDataSignature = "";

function renderAlbums() {
  const container = document.getElementById("albums");

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
      const safeCoverUrl = escapeHtml(album.coverUrl);
      const detailListMarkup = (album.details || [])
        .map((detail) => `<li>${escapeHtml(detail)}</li>`)
        .join("");
      const spotifyButtonMarkup = album.spotifyUrl
        ? `<a class="album-action-button" href="${escapeHtml(album.spotifyUrl)}" target="_blank" rel="noreferrer">Open on Spotify</a>`
        : "";
      const linksMarkup = spotifyButtonMarkup
        ? `<div class="album-links">${spotifyButtonMarkup}</div>`
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
            <img src="${safeCoverUrl}" alt="${safeTitle} album cover" loading="lazy" onerror="this.onerror=null;this.src='${coverFallbackUrl}'" />
          </button>
          <div id="album-details-${album.id}" class="album-details">
            <h2>${safeTitle}</h2>
            <p class="meta">${safeArtist} • ${safeYear}</p>
            <p class="meta">${safeGenre}</p>
            <p class="notes">${safeNotes}</p>
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
    throw new Error("Could not load discogs-collection.json");
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
          `Source page: ${item.sourcePage || "?"}`,
          `Discogs artist page: ${item.artistUrl ? "Available" : "n/a"}`,
          item.imageUrl ? "Cover image cached from Discogs" : "No cover image found",
          `Collection record: ${item.rawText ? item.rawText.slice(0, 120) : ""}`
        ].filter(Boolean);

    const spotifyQuery = [item.artist, item.title]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
    const spotifyUrl = spotifyQuery
      ? `https://open.spotify.com/search/${encodeURIComponent(spotifyQuery)}`
      : "";

    return {
      id: item.releaseUrl || `${item.title}-${item.artist}-${index}`,
      title: item.title || "Untitled release",
      artist: item.artist || "Unknown artist",
      year: item.year || "Unknown year",
      genre: item.rawText || "Discogs collection item",
      notes: tracks.length ? `${tracks.length} songs` : `Release page ${item.sourcePage || "?"}`,
      releaseUrl: item.releaseUrl || "",
      spotifyUrl,
      coverUrl: item.imageUrl || coverFallbackUrl,
      details
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

  section.hidden = true;
  currentNowPlaying = null;
  renderReviewBubbles([], "");
}

function getSongKey(nowPlaying) {
  if (!nowPlaying || !nowPlaying.albumTitle || !nowPlaying.songTitle) {
    return "";
  }

  return `${nowPlaying.albumTitle}::${nowPlaying.songTitle}`;
}

async function fetchSongReviews(songKey) {
  if (!songKey) {
    return [];
  }

  const response = await fetch(`/api/reviews?songKey=${encodeURIComponent(songKey)}&t=${Date.now()}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not load reviews");
  }

  const payload = await response.json();
  return Array.isArray(payload.reviews) ? payload.reviews : [];
}

async function fetchSongReviewsFromFile(songKey) {
  if (!songKey) {
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

  return Array.isArray(payload[songKey]) ? payload[songKey] : [];
}

async function fetchCurrentSongReviews() {
  const songKey = getSongKey(currentNowPlaying);

  if (!songKey) {
    renderReviewBubbles([], "");
    return;
  }

  try {
    const reviews = await fetchSongReviews(songKey);
    renderReviewBubbles(reviews, songKey);
  } catch {
    try {
      const reviews = await fetchSongReviewsFromFile(songKey);
      renderReviewBubbles(reviews, songKey);

      if (reviews.length) {
        showReviewStatus("Showing reviews from file fallback.");
        return;
      }
    } catch {
      // Ignore fallback errors and show primary message below.
    }

    renderReviewBubbles([], songKey);
    showReviewStatus("Could not load reviews.");
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getReviewerKey(name) {
  return (name || "Anonymous").trim().toLowerCase();
}

function formatReviewDate(isoDate) {
  if (!isoDate) {
    return "Unknown date";
  }

  if (/^\d{2}\/\d{2}\/\d{2}$/.test(isoDate)) {
    return isoDate;
  }

  const value = new Date(isoDate);

  if (Number.isNaN(value.getTime())) {
    return "Unknown date";
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
    const normalizedKey = getReviewerKey(review.name);
    const safeName = (review.name || "Anonymous").trim() || "Anonymous";

    if (!grouped.has(normalizedKey)) {
      grouped.set(normalizedKey, {
        reviewerKey: normalizedKey,
        displayName: safeName,
        reviews: []
      });
    }

    grouped.get(normalizedKey).reviews.push({
      name: safeName,
      text: review.text || "",
      rating: Number(review.rating || 0),
      createdAt: review.createdAt || ""
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
      displayName: group.displayName,
      averageRating: average,
      reviews: sortedReviews
    };
  });
}

function renderReviewBubbles(reviews, songKey = "") {
  const bubbleLayer = document.getElementById("bubble-layer");
  const reviewsSignature = JSON.stringify(reviews);
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

  if (songKey === lastBubbleSongKey && reviewsSignature === lastBubbleDataSignature) {
    return;
  }

  if (!reviews.length) {
    bubbleLayer.innerHTML = "";
    lastBubbleSongKey = songKey;
    lastBubbleDataSignature = reviewsSignature;
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
      const historyMarkup = group.reviews
        .map((entry) => {
          const safeText = escapeHtml(entry.text || "");
          const safeRating = Number(entry.rating || 0).toFixed(1);
          const safeDate = escapeHtml(formatReviewDate(entry.createdAt));

          return `
            <li class="review-history-item">
              <p class="review-history-meta">${safeDate} - ${safeRating} / 5</p>
              <p class="review-history-text">${safeText}</p>
            </li>
          `;
        })
        .join("");

      return `
        <article class="review-bubble ${expanded ? "expanded" : ""}" data-review-id="${encodedId}" style="left:${left}%; top:${top}%; --delay:${delay}s; --duration:${duration}s; --drift-x:${driftX}px; --drift-y:${driftY}px;">
          <div class="review-bubble-summary">
            <p class="review-bubble-name">${safeName}</p>
            <p class="review-bubble-rating">Avg ${safeAverage} / 5</p>
          </div>
          <ol class="review-bubble-text review-history-list">${historyMarkup}</ol>
        </article>
      `;
    })
    .join("");

  lastBubbleSongKey = songKey;
  lastBubbleDataSignature = reviewsSignature;
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
  const nameInput = document.getElementById("reviewer-name");
  const reviewInput = document.getElementById("album-review");

  if (nameInput) {
    nameInput.value = "";
  }

  if (reviewInput) {
    reviewInput.value = "";
  }

  selectedRating = 0;
  renderRating(selectedRating);
}

async function saveCurrentReview() {
  const nameInput = document.getElementById("reviewer-name");
  const reviewInput = document.getElementById("album-review");
  const key = getSongKey(currentNowPlaying);

  if (!currentNowPlaying || !key) {
    showReviewStatus("No song is currently playing.");
    return;
  }

  const name = (nameInput?.value || "").trim();
  const text = (reviewInput?.value || "").trim();

  if (!name) {
    showReviewStatus("Add your name.");
    return;
  }

  if (!text) {
    showReviewStatus("Write a review first.");
    return;
  }

  if (selectedRating <= 0) {
    showReviewStatus("Pick a rating from 0.5 to 5.");
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
        review: {
          name,
          text,
          rating: selectedRating,
          createdAt: new Date().toISOString()
        }
      })
    });

    if (!response.ok) {
      throw new Error("Could not save review");
    }

    const payload = await response.json();
    const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    showReviewStatus("Review saved.");
    renderReviewBubbles(reviews, key);
    resetReviewInputs();
  } catch {
    showReviewStatus("Could not save review.");
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
    ratingValue.textContent = `Rating: ${rating} / 5`;
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

  if (!nowPlaying || !nowPlaying.albumTitle || !nowPlaying.songTitle || !nowPlaying.coverUrl) {
    hideNowPlaying();
    return;
  }

  const signature = `${nowPlaying.albumTitle}|${nowPlaying.songTitle}|${nowPlaying.coverUrl}`;

  if (signature !== lastNowPlayingSignature || section.hidden) {
    text.textContent = `${nowPlaying.albumTitle} - ${nowPlaying.songTitle}`;
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
    title.textContent = "Access Restricted";
    message.textContent = "This page is available only on phones from a local address.";
    document.getElementById("albums").innerHTML = "";
    hideNowPlaying();
    return;
  }

  message.textContent = "Tap any album to expand details. Tap again to collapse.";
  setupAlbumInteractions();
  setupNowPlayingInteractions();
  setupBubbleInteractions();
  startNowPlayingPolling();

  loadAlbums()
    .then((albumDatabase) => {
      appState.albums = Array.isArray(albumDatabase) ? albumDatabase : (albumDatabase.albums || []);
      renderAlbums();
    })
    .catch(() => {
      message.textContent = "Could not load albums data.";
      document.getElementById("albums").innerHTML = "";
    });
})();
