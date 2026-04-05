// content.js – läuft auf aniworld.to

const THRESHOLD_SEC = 150;
let currentUrl = "";
let countdownInterval = null;
let urlCheckInterval = null;
let timeRemaining = 0;
let isTrackingCompleted = false;
let isPaused = false;
let currentAnimeInfo = null;
let cachedAnimeData = null;

// ─────────────────────────────────────────────
// URL parsen
// ─────────────────────────────────────────────
function parseAniWorldURL(url) {
  const match = url.match(
    /aniworld\.to\/anime\/stream\/([^/]+)\/staffel-(\d+)\/episode-(\d+)/
  );
  if (!match) return null;
  const slug = match[1];
  const season = parseInt(match[2]);
  const episode = parseInt(match[3]);
  const title = slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return { slug, title, season, episode };
}

// ─────────────────────────────────────────────
// Floating Badge (Countdown)
// ─────────────────────────────────────────────
function getOrCreateBadge() {
  let badge = document.getElementById("anilist-tracker-container");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "anilist-tracker-container";
    badge.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      background: #1e1e2e; border: 1px solid #313244; border-radius: 12px;
      padding: 12px 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #cdd6f4; box-shadow: 0 8px 24px rgba(0,0,0,0.5); width: 300px;
      transition: all 0.3s ease;
    `;

    badge.innerHTML = `
      <div id="at-main-view">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:13px; gap:6px;">
          <strong id="at-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; cursor:pointer; color:#cdd6f4;" title="Klicken zum Bewerten">Lade...</strong>
          <div style="display:flex; gap:5px; align-items:center; flex-shrink:0;">
            <button id="at-pause-btn" title="Pausieren" style="
              background:#313244; border:none; border-radius:6px; color:#cdd6f4;
              cursor:pointer; font-size:12px; padding:3px 7px; line-height:1.5;
              transition:background 0.2s;">⏸</button>
            <button id="at-info-btn" title="AniList Infos" style="
              background:#313244; border:none; border-radius:6px; color:#89b4fa;
              cursor:pointer; font-size:12px; padding:3px 7px; line-height:1.5;
              transition:background 0.2s;">ℹ️</button>
            <span id="at-time" style="font-family:monospace; color:#a6adc8; font-weight:bold; min-width:38px; text-align:right;">02:30</span>
          </div>
        </div>
        <div id="at-progress-container" style="width:100%; height:6px; background:#313244; border-radius:3px; overflow:hidden; margin-bottom:4px;">
          <div id="at-progress" style="width:0%; height:100%; background:#89b4fa; transition:width 1s linear;"></div>
        </div>
        <div id="at-status-text" style="font-size:11px; color:#9399b2; text-align:center; margin-top:4px;"></div>
      </div>

      <div id="at-rating-view" style="display:none; text-align:center;">
        <div style="font-size:13px; font-weight:bold; margin-bottom:10px;">Wie fandest du den Anime?</div>
        <div id="at-stars" style="display:flex; justify-content:center; gap:4px; margin-bottom:12px;"></div>
        <button id="at-cancel-rating" style="background:transparent; border:none; color:#f38ba8; cursor:pointer; font-size:11px;">Abbrechen</button>
      </div>

      <div id="at-info-view" style="display:none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span style="font-size:12px; font-weight:bold; color:#89b4fa;">📋 AniList Info</span>
          <button id="at-info-close" style="background:transparent; border:none; color:#6c7086; cursor:pointer; font-size:16px; line-height:1; padding:0;">✕</button>
        </div>
        <div id="at-info-content" style="display:flex; gap:10px;">
          <div style="color:#6c7086; font-size:12px; text-align:center; width:100%; padding:12px 0;">Lädt...</div>
        </div>
      </div>
    `;

    document.body.appendChild(badge);
    document.getElementById("at-title").onclick = () => showRatingView();
    document.getElementById("at-cancel-rating").onclick = () => hideRatingView();
    document.getElementById("at-info-btn").onclick = () => toggleInfoView();
    document.getElementById("at-info-close").onclick = () => hideInfoView();
    document.getElementById("at-pause-btn").onclick = () => togglePause();
  }
  return badge;
}

// ─────────────────────────────────────────────
// Pause / Resume
// ─────────────────────────────────────────────
function togglePause() {
  isPaused = !isPaused;
  const btn = document.getElementById("at-pause-btn");
  const statusEl = document.getElementById("at-status-text");
  if (isPaused) {
    btn.textContent = "▶";
    btn.title = "Fortsetzen";
    btn.style.color = "#a6e3a1";
    if (statusEl) { statusEl.textContent = "⏸ Pausiert"; statusEl.style.color = "#f9e2af"; }
  } else {
    btn.textContent = "⏸";
    btn.title = "Pausieren";
    btn.style.color = "#cdd6f4";
    if (statusEl) { statusEl.textContent = "Wird getrackt..."; statusEl.style.color = "#9399b2"; }
  }
}

// ─────────────────────────────────────────────
// Info-View (Badge)
// ─────────────────────────────────────────────
function toggleInfoView() {
  const iv = document.getElementById("at-info-view");
  const mv = document.getElementById("at-main-view");
  if (!iv || !mv) return;
  if (iv.style.display === "none") { mv.style.display = "none"; iv.style.display = "block"; }
  else { hideInfoView(); }
}

function hideInfoView() {
  const iv = document.getElementById("at-info-view");
  const mv = document.getElementById("at-main-view");
  if (iv) iv.style.display = "none";
  if (mv) mv.style.display = "block";
}

function renderBadgeAnimeInfo(anime) {
  const container = document.getElementById("at-info-content");
  if (!container) return;
  if (!anime) {
    container.innerHTML = `<div style="color:#f38ba8;font-size:12px;width:100%;text-align:center;">Keine Daten gefunden</div>`;
    return;
  }
  const title = anime.title.english || anime.title.romaji;
  const score = anime.averageScore ? `${anime.averageScore}%` : "N/A";
  const scoreColor = anime.averageScore >= 75 ? "#a6e3a1" : anime.averageScore >= 60 ? "#f9e2af" : "#f38ba8";
  const episodes = anime.episodes ? `${anime.episodes} Ep.` : "? Ep.";
  const studio = anime.studios?.nodes?.[0]?.name || "";
  const year = anime.seasonYear || "";
  const season = anime.season ? capitalize(anime.season.toLowerCase()) : "";
  const seasonYear = [season, year].filter(Boolean).join(" ");
  const statusMap = { FINISHED:"Abgeschlossen", RELEASING:"Läuft", NOT_YET_RELEASED:"Noch nicht", CANCELLED:"Abgebrochen", HIATUS:"Pause" };
  const statusLabel = statusMap[anime.status] || anime.status;
  const statusColor = anime.status === "RELEASING" ? "#a6e3a1" : "#6c7086";
  const genres = (anime.genres || []).slice(0, 3).map(g =>
    `<span style="background:#313244;border-radius:4px;padding:2px 6px;font-size:10px;color:#89b4fa;">${g}</span>`
  ).join("");
  let desc = (anime.description || "").replace(/<[^>]*>/g, "").trim();
  if (desc.length > 120) desc = desc.slice(0, 117) + "…";

  container.innerHTML = `
    <img src="${anime.coverImage?.medium || ""}" alt="" style="
      width:72px;height:102px;object-fit:cover;border-radius:6px;flex-shrink:0;border:1px solid #313244;
    " onerror="this.style.display='none'" />
    <div style="flex:1;min-width:0;">
      <div style="font-size:12px;font-weight:bold;color:#cdd6f4;margin-bottom:4px;
           white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${title}">${title}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:5px;flex-wrap:wrap;">
        <span style="font-size:11px;font-weight:bold;color:${scoreColor};">⭐ ${score}</span>
        <span style="font-size:10px;color:#6c7086;">•</span>
        <span style="font-size:10px;color:#a6adc8;">${episodes}</span>
        <span style="font-size:10px;color:#6c7086;">•</span>
        <span style="font-size:10px;color:${statusColor};">${statusLabel}</span>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px;">${genres}</div>
      <div style="font-size:10px;color:#6c7086;margin-bottom:4px;">${[studio,seasonYear].filter(Boolean).join(" · ")}</div>
      ${desc ? `<div style="font-size:10px;color:#9399b2;line-height:1.4;">${desc}</div>` : ""}
    </div>
  `;
  container.style.display = "flex";
}

// ─────────────────────────────────────────────
// Integrierte AniList-Leiste
// ─────────────────────────────────────────────
function injectAniListBar(info, anime) {
  const old = document.getElementById("al-bar");
  if (old) old.remove();

  const bar = document.createElement("div");
  bar.id = "al-bar";
  bar.style.cssText = `
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    overflow: visible;
    margin: 10px 0 14px 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    position: relative;
    z-index: 1000;
  `;

  if (!anime) {
    bar.innerHTML = `<div style="grid-column:1/-1;padding:10px 16px;color:#6c7086;font-size:12px;text-align:center;">AniList: Anime nicht gefunden</div>`;
    insertBarIntoPage(bar);
    return;
  }

  const entry = anime.mediaListEntry;
  const STATUS_MAP = {
    CURRENT: "Watching",
    COMPLETED: "Completed",
    PLANNING: "Planning",
    PAUSED: "Paused",
    DROPPED: "Dropped",
    REPEATING: "Rewatching"
  };

  const statusLabel = entry ? (STATUS_MAP[entry.status] || entry.status) : "–";
  const scoreLabel = entry?.score ? String(Math.round(entry.score)) : "–";
  const progressLabel = `${entry?.progress ?? 0}/${anime.episodes ?? "?"}`;
  const avgScore = anime.averageScore ?? "–";
  const anilistUrl = `https://anilist.co/anime/${anime.id}`;
  const hasToken = entry !== undefined; // null = logged in but not in list, undefined = no token

  const CELL = `padding:10px 16px; border-right:1px solid #30363d; cursor:pointer;
    user-select:none; transition:background 0.15s; position:relative; overflow:visible;`;

  bar.innerHTML = `
    <style>
      #al-bar .al-cell:last-child { border-right: none !important; }
      #al-bar .al-cell:hover { background: #1c2333 !important; }
      #al-bar .al-lbl { display:block; font-size:10px; color:#8b949e; text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; }
      #al-bar .al-val { display:block; font-size:15px; font-weight:600; color:#e6edf3; }
      #al-bar .al-hint { font-size:10px; color:#484f58; margin-left:3px; }

      /* Dropdown */
      #al-bar .al-drop {
        position:absolute; top:calc(100% + 4px); left:0; min-width:170px;
        background:#1c2333; border:1px solid #30363d; border-radius:6px;
        box-shadow:0 8px 28px rgba(0,0,0,0.7); z-index:99999;
        overflow:hidden; display:none;
      }
      #al-bar .al-drop.open { display:block; }
      #al-bar .al-ditem { padding:9px 14px; font-size:12px; color:#c9d1d9; cursor:pointer; transition:background 0.12s; }
      #al-bar .al-ditem:hover { background:#21262d; }
      #al-bar .al-ditem.active { color:#58a6ff; font-weight:600; }

      /* Popup */
      #al-bar .al-pop {
        position:absolute; top:calc(100% + 4px); left:0; min-width:210px;
        background:#1c2333; border:1px solid #30363d; border-radius:6px;
        box-shadow:0 8px 28px rgba(0,0,0,0.7); z-index:99999;
        padding:14px; display:none;
      }
      #al-bar .al-pop.open { display:block; }
      #al-bar .al-plbl { font-size:11px; color:#8b949e; margin-bottom:8px; display:block; }
      #al-bar .al-inp {
        width:100%; padding:7px 9px; background:#0d1117; border:1px solid #30363d;
        border-radius:5px; color:#e6edf3; font-size:13px; box-sizing:border-box; outline:none;
      }
      #al-bar .al-inp:focus { border-color:#58a6ff; }
      #al-bar .al-sbtn {
        margin-top:9px; width:100%; padding:8px; background:#238636; border:none;
        border-radius:5px; color:#fff; font-size:12px; font-weight:600; cursor:pointer;
      }
      #al-bar .al-sbtn:hover { background:#2ea043; }
      #al-bar .al-fb { font-size:11px; text-align:center; margin-top:7px; min-height:14px; }
      #al-bar .al-srow { display:flex; gap:3px; justify-content:center; margin-bottom:10px; }
      #al-bar .al-star { font-size:22px; color:#30363d; cursor:pointer; transition:color 0.12s; line-height:1; }
    </style>

    <!-- Zelle 1: Community-Score → öffnet AniList -->
    <div class="al-cell" id="al-c-score" style="${CELL}" title="Auf AniList ansehen ↗">
        <span class="al-lbl">AniList Bewertung</span>
        <span class="al-val" style="color: ${avgScore > 75 ? '#2ecc71' : (avgScore >= 50 ? '#f0b429' : '#e74c3c')};">${avgScore}<span class="al-hint">%</span></span>
    </div>

    <!-- Zelle 2: Listen-Status (Dropdown) -->
    <div class="al-cell" id="al-c-status" style="${CELL}" title="Status ändern">
      <span class="al-lbl">Status</span>
      <span class="al-val" id="al-v-status">${statusLabel}<span class="al-hint">${entry !== undefined ? "▾" : ""}</span></span>
      <div class="al-drop" id="al-d-status">
        ${Object.entries(STATUS_MAP).map(([k,v]) =>
          `<div class="al-ditem${entry?.status === k ? " active" : ""}" data-s="${k}">${v}</div>`
        ).join("")}
      </div>
    </div>

    <!-- Zelle 3: Episode-Fortschritt (Popup) -->
    <div class="al-cell" id="al-c-ep" style="${CELL}" title="Episoden-Fortschritt anpassen">
      <span class="al-lbl">Episode</span>
      <span class="al-val" id="al-v-ep">${progressLabel}<span class="al-hint">${entry !== undefined ? "✎" : ""}</span></span>
      <div class="al-pop" id="al-p-ep">
        <span class="al-plbl">Gesehene Episoden (von ${anime.episodes ?? "?"})</span>
        <input class="al-inp" id="al-i-ep" type="number" min="0" max="${anime.episodes ?? 9999}"
          value="${entry?.progress ?? 0}" />
        <button class="al-sbtn" id="al-s-ep">Speichern</button>
        <div class="al-fb" id="al-f-ep"></div>
      </div>
    </div>

    <!-- Zelle 4: Eigene Wertung (Popup) -->
    <div class="al-cell" id="al-c-rate" style="${CELL}" title="Eigene Bewertung abgeben">
      <span class="al-lbl">Eigene Wertung</span>
      <span class="al-val" id="al-v-rate" style="color:#a6e3a1;">${scoreLabel}<span class="al-hint">${entry !== undefined ? "✎" : ""}</span></span>
      <div class="al-pop" id="al-p-rate" style="min-width:230px;">
        <span class="al-plbl">Bewertung abgeben (1–10)</span>
        <div class="al-srow" id="al-srow"></div>
        <input class="al-inp" id="al-i-rate" type="number" min="1" max="10"
          value="${entry?.score ? Math.round(entry.score) : ""}" placeholder="1 – 10" />
        <button class="al-sbtn" id="al-s-rate">Speichern</button>
        <div class="al-fb" id="al-f-rate"></div>
      </div>
    </div>
  `;

  insertBarIntoPage(bar);

  const animeId = anime.id;

  // ── Score → AniList-Link ──
  document.getElementById("al-c-score").onclick = () => window.open(anilistUrl, "_blank");

  // ── Status-Dropdown ──
  const ddStatus = document.getElementById("al-d-status");
  document.getElementById("al-c-status").onclick = (e) => {
    e.stopPropagation();
    if (entry === undefined) return;
    closeAllBarPopups();
    ddStatus.classList.toggle("open");
  };
  ddStatus.querySelectorAll(".al-ditem").forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const newStatus = item.dataset.s;
      item.textContent = "Speichert…";
      chrome.runtime.sendMessage(
        { type: "SAVE_LIST_ENTRY", payload: { mediaId: animeId, status: newStatus } },
        (res) => {
          closeAllBarPopups();
          if (res?.success) {
            document.getElementById("al-v-status").innerHTML =
              `${STATUS_MAP[newStatus]}<span class="al-hint">▾</span>`;
            ddStatus.querySelectorAll(".al-ditem").forEach(i => {
              i.className = "al-ditem" + (i.dataset.s === newStatus ? " active" : "");
              i.textContent = STATUS_MAP[i.dataset.s];
            });
          } else {
            ddStatus.querySelectorAll(".al-ditem").forEach(i => { i.textContent = STATUS_MAP[i.dataset.s]; });
          }
        }
      );
    };
  });

  // ── Episoden-Popup ──
  const popEp = document.getElementById("al-p-ep");
  document.getElementById("al-c-ep").onclick = (e) => {
    e.stopPropagation();
    if (entry === undefined) return;
    closeAllBarPopups();
    popEp.classList.toggle("open");
    if (popEp.classList.contains("open")) document.getElementById("al-i-ep").focus();
  };
  document.getElementById("al-s-ep").onclick = (e) => {
    e.stopPropagation();
    const val = parseInt(document.getElementById("al-i-ep").value);
    const fb = document.getElementById("al-f-ep");
    if (isNaN(val) || val < 0) { fb.style.color = "#f85149"; fb.textContent = "Ungültige Zahl"; return; }
    fb.style.color = "#8b949e"; fb.textContent = "Speichert…";
    chrome.runtime.sendMessage(
      { type: "SAVE_LIST_ENTRY", payload: { mediaId: animeId, progress: val } },
      (res) => {
        if (res?.success) {
          document.getElementById("al-v-ep").innerHTML =
            `${val}/${anime.episodes ?? "?"}<span class="al-hint">✎</span>`;
          fb.style.color = "#3fb950"; fb.textContent = "✅ Gespeichert!";
          setTimeout(() => closeAllBarPopups(), 800);
        } else {
          fb.style.color = "#f85149"; fb.textContent = "❌ Fehler";
        }
      }
    );
  };

  // ── Bewertungs-Popup ──
  const popRate = document.getElementById("al-p-rate");
  const srow = document.getElementById("al-srow");
  const ratingInput = document.getElementById("al-i-rate");
  for (let i = 1; i <= 10; i++) {
    const s = document.createElement("span");
    s.className = "al-star";
    s.textContent = "★";
    s.dataset.v = i;
    s.onmouseover = () => hlBarStars(i);
    s.onmouseout = () => hlBarStars(parseInt(ratingInput.value) || 0);
    s.onclick = (e) => {
      e.stopPropagation();
      ratingInput.value = i;
      hlBarStars(i);
    };
    srow.appendChild(s);
  }
  hlBarStars(entry?.score ? Math.round(entry.score) : 0);
  ratingInput.oninput = () => hlBarStars(parseInt(ratingInput.value) || 0);

  document.getElementById("al-c-rate").onclick = (e) => {
    e.stopPropagation();
    if (entry === undefined) return;
    closeAllBarPopups();
    popRate.classList.toggle("open");
  };
  document.getElementById("al-s-rate").onclick = (e) => {
    e.stopPropagation();
    const val = parseInt(ratingInput.value);
    const fb = document.getElementById("al-f-rate");
    if (isNaN(val) || val < 1 || val > 10) { fb.style.color = "#f85149"; fb.textContent = "Bitte 1–10 eingeben"; return; }
    fb.style.color = "#8b949e"; fb.textContent = "Speichert…";
    chrome.runtime.sendMessage(
      { type: "RATE_ANIME", payload: { ...currentAnimeInfo, score: val } },
      (res) => {
        if (res?.success) {
          document.getElementById("al-v-rate").innerHTML =
            `${val}<span class="al-hint">✎</span>`;
          fb.style.color = "#3fb950"; fb.textContent = "✅ Gespeichert!";
          setTimeout(() => closeAllBarPopups(), 800);
        } else {
          fb.style.color = "#f85149"; fb.textContent = "❌ Fehler";
        }
      }
    );
  };

  // Klick außerhalb schließt alle Popups
  document.addEventListener("click", closeAllBarPopups);
}

function hlBarStars(count) {
  document.querySelectorAll("#al-srow .al-star").forEach((s, idx) => {
    s.style.color = idx < count ? "#f0b429" : "#30363d";
  });
}

function closeAllBarPopups() {
  document.querySelectorAll("#al-bar .al-drop, #al-bar .al-pop").forEach(el => el.classList.remove("open"));
}

function insertBarIntoPage(bar) {
  const selectors = [
    ".hosterSite",
    "#streamLinks",
    ".episodesList",
    "h2.seasonEpisodeTitle",
    ".hosterSiteDirectNav",
    ".tabsContainer",
    ".series-container",
    "#stream",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) { el.parentNode.insertBefore(bar, el); return; }
  }
  const bc = document.querySelector(".breadcrumb, nav ol, .breadcrumbs");
  if (bc) { bc.insertAdjacentElement("afterend", bar); return; }
  document.body.insertBefore(bar, document.body.firstChild);
}

// ─────────────────────────────────────────────
// AniList-Daten laden
// ─────────────────────────────────────────────
function fetchAndRenderAll(info) {
  const container = document.getElementById("at-info-content");
  if (container) {
    container.innerHTML = `<div style="color:#6c7086;font-size:12px;text-align:center;width:100%;padding:12px 0;">Lädt...</div>`;
    container.style.display = "flex";
  }
  chrome.runtime.sendMessage(
    { type: "GET_ANIME_INFO", payload: { title: info.title, season: info.season } },
    (response) => {
      cachedAnimeData = response?.success ? response.anime : null;
      renderBadgeAnimeInfo(cachedAnimeData);
      tryInjectBar(info, cachedAnimeData, 20);
    }
  );
}

function tryInjectBar(info, anime, retries) {
  const found = [".hosterSite","#streamLinks",".episodesList","h2.seasonEpisodeTitle",".hosterSiteDirectNav",".tabsContainer"]
    .some(sel => document.querySelector(sel));
  if (found || retries <= 0) {
    injectAniListBar(info, anime);
  } else {
    setTimeout(() => tryInjectBar(info, anime, retries - 1), 400);
  }
}

// ─────────────────────────────────────────────
// Rating (Badge)
// ─────────────────────────────────────────────
function showRatingView() {
  getOrCreateBadge();
  document.getElementById("at-main-view").style.display = "none";
  document.getElementById("at-rating-view").style.display = "block";
  document.getElementById("at-info-view").style.display = "none";
  const starsContainer = document.getElementById("at-stars");
  starsContainer.innerHTML = "";
  for (let i = 1; i <= 10; i++) {
    const star = document.createElement("span");
    star.innerHTML = "★";
    star.style.cssText = `cursor:pointer;font-size:18px;color:#45475a;transition:color 0.2s;`;
    star.onmouseover = () => hlBadgeStars(i);
    star.onmouseout = () => hlBadgeStars(0);
    star.onclick = () => submitBadgeRating(i);
    starsContainer.appendChild(star);
  }
}

function hlBadgeStars(count) {
  document.querySelectorAll("#at-stars span").forEach((s, idx) => {
    s.style.color = idx < count ? "#f9e2af" : "#45475a";
  });
}

function hideRatingView() {
  document.getElementById("at-main-view").style.display = "block";
  document.getElementById("at-rating-view").style.display = "none";
}

function submitBadgeRating(score) {
  const statusText = document.getElementById("at-status-text");
  hideRatingView();
  statusText.textContent = `⭐ Sende ${score}/10 an AniList...`;
  chrome.runtime.sendMessage(
    { type: "RATE_ANIME", payload: { ...currentAnimeInfo, score } },
    (response) => {
      if (response?.success) {
        statusText.textContent = `✅ Bewertung gespeichert!`;
        statusText.style.color = "#a6e3a1";
        const vr = document.getElementById("al-v-rate");
        if (vr) vr.innerHTML = `${score}<span class="al-hint">✎</span>`;
      } else {
        statusText.textContent = `❌ Fehler beim Bewerten`;
        statusText.style.color = "#f38ba8";
      }
      setTimeout(() => { statusText.textContent = ""; statusText.style.color = "#9399b2"; }, 3000);
    }
  );
}

// ─────────────────────────────────────────────
// Badge UI-Updates
// ─────────────────────────────────────────────
function updateBadgeUI(info, statusText, color, hideTime = false) {
  getOrCreateBadge();
  document.getElementById("at-title").textContent = `${info.title} E${info.episode}`;
  const statusEl = document.getElementById("at-status-text");
  if (statusText) { statusEl.textContent = statusText; statusEl.style.color = "#9399b2"; }
  document.getElementById("at-progress").style.backgroundColor = color || "#89b4fa";
  const timeEl = document.getElementById("at-time");
  const pauseBtn = document.getElementById("at-pause-btn");
  timeEl.style.display = hideTime ? "none" : "block";
  if (pauseBtn) pauseBtn.style.display = hideTime ? "none" : "block";
}

function updateProgress(secondsLeft) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  document.getElementById("at-time").textContent =
    `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  document.getElementById("at-progress").style.width =
    `${((THRESHOLD_SEC - secondsLeft) / THRESHOLD_SEC) * 100}%`;
}

// ─────────────────────────────────────────────
// Tracking
// ─────────────────────────────────────────────
function startTracking(info) {
  clearInterval(countdownInterval);
  timeRemaining = THRESHOLD_SEC;
  isTrackingCompleted = false;
  isPaused = false;
  currentAnimeInfo = info;
  cachedAnimeData = null;

  const badge = getOrCreateBadge();
  badge.style.display = "block";
  const pauseBtn = document.getElementById("at-pause-btn");
  if (pauseBtn) { pauseBtn.textContent = "⏸"; pauseBtn.style.color = "#cdd6f4"; }

  updateBadgeUI(info, "Wird getrackt...", null, false);
  updateProgress(timeRemaining);
  fetchAndRenderAll(info);

  countdownInterval = setInterval(() => {
    if (isPaused) return;
    timeRemaining--;
    if (timeRemaining > 0) {
      updateProgress(timeRemaining);
    } else {
      clearInterval(countdownInterval);
      isTrackingCompleted = true;
      document.getElementById("at-progress").style.width = "100%";
      updateBadgeUI(info, "📡 Speichere auf AniList...", "#f9e2af", true);

      chrome.runtime.sendMessage(
        { type: "TRACK_EPISODE", payload: info },
        (response) => {
          if (response?.success) {
            let msg = `✅ Episode ${info.episode} gespeichert!`;
            if (response.isCompleted) { msg = "🏁 Finale erreicht! Bitte bewerten:"; showRatingView(); }
            updateBadgeUI(info, msg, "#a6e3a1", true);
            const epEl = document.getElementById("al-v-ep");
            if (epEl && cachedAnimeData) {
              epEl.innerHTML = `${info.episode}/${cachedAnimeData.episodes ?? "?"}<span class="al-hint">✎</span>`;
            }
          } else {
            updateBadgeUI(info, `❌ ${response?.error || "Fehler"}`, "#f38ba8", true);
          }
        }
      );
    }
  }, 1000);
}

// ─────────────────────────────────────────────
// Hilfsfunktionen & Init
// ─────────────────────────────────────────────
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

function init() {
  urlCheckInterval = setInterval(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      const info = parseAniWorldURL(currentUrl);
      if (info) {
        startTracking(info);
      } else {
        clearInterval(countdownInterval);
        const badge = document.getElementById("anilist-tracker-container");
        if (badge) badge.style.display = "none";
        const bar = document.getElementById("al-bar");
        if (bar) bar.remove();
      }
    }
  }, 1000);
}

init();
