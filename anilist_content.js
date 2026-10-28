// anilist_content.js – läuft auf anilist.co (QuickLink zu AniWorld)
// AniList ist eine Single-Page-App: die URL ändert sich ohne Neuladen → URL regelmäßig prüfen.

const AW_BTN_ID = "aw-quicklink";
let awMediaId = null;     // Anime-ID der aktuellen Seite
let awState = null;       // { id, status: "loading" | "found" | "missing", url, label, title }
let awSeq = 0;            // verwirft veraltete Antworten

function awCurrentId() {
  const m = location.pathname.match(/^\/anime\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function awRemoveButton() {
  document.getElementById(AW_BTN_ID)?.remove();
}

function awStyleButton(el, floating) {
  el.style.cssText = `
    display:inline-flex; align-items:center; justify-content:center; gap:6px;
    height:35px; padding:0 16px; border-radius:4px; cursor:pointer;
    background:#e8590c; color:#fff; font-size:13px; font-weight:600;
    font-family:Overpass, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-decoration:none; white-space:nowrap; line-height:1; margin-left:10px;
    ${floating ? "position:fixed; bottom:20px; left:20px; z-index:99999; margin-left:0; box-shadow:0 4px 14px rgba(0,0,0,.4);" : ""}
  `;
}

function awApplyState(el) {
  if (!awState) return;
  el.textContent = awState.label;
  el.title = awState.title || "";
  if (awState.status === "found" || awState.url) {
    el.href = awState.url;
    el.style.opacity = awState.status === "found" ? "1" : "0.75";
    el.style.pointerEvents = "auto";
  } else {
    el.removeAttribute("href");
    el.style.opacity = "0.6";
    el.style.pointerEvents = "none";
  }
}

// Button in die Aktionsleiste (neben „Add to List“) setzen; sonst schwebend unten links
function awEnsureButton() {
  if (!awState || awState.id !== awCurrentId()) return;

  const existing = document.getElementById(AW_BTN_ID);
  const actions = document.querySelector(".header .content .actions, .header .actions, .actions");

  if (existing) {
    const floating = existing.dataset.floating === "1";
    if (!floating || !actions) { awApplyState(existing); return; }
    existing.remove();            // schwebend → in die Leiste umziehen, sobald sie da ist
  }

  const a = document.createElement("a");
  a.id = AW_BTN_ID;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  const floating = !actions;
  a.dataset.floating = floating ? "1" : "0";
  awStyleButton(a, floating);
  awApplyState(a);
  if (actions) actions.appendChild(a);
  else document.body.appendChild(a);
}

function awLookup(id) {
  const seq = ++awSeq;
  awState = { id, status: "loading", label: "AniWorld …", title: "Suche auf AniWorld", url: "" };
  awEnsureButton();

  chrome.runtime.sendMessage({ type: "FIND_ANIWORLD", payload: { mediaId: id } }, (res) => {
    void chrome.runtime.lastError;
    if (seq !== awSeq || id !== awCurrentId()) return;

    if (res?.success && res.found && res.url) {
      const label = res.kind === "season" ? `▶ AniWorld · Staffel ${res.season}` : "▶ AniWorld · Filme";
      awState = { id, status: "found", url: res.url, label, title: res.url };
    } else if (res?.searchUrl) {
      awState = { id, status: "missing", url: res.searchUrl, label: "AniWorld suchen", title: "Nicht eindeutig gefunden – Suche öffnen" };
    } else {
      awState = { id, status: "missing", url: "", label: "Nicht auf AniWorld", title: res?.error || "Kein Treffer" };
    }
    awEnsureButton();
  });
}

setInterval(() => {
  const id = awCurrentId();
  if (id !== awMediaId) {
    awMediaId = id;
    awState = null;
    awRemoveButton();
    if (id) awLookup(id);
    return;
  }
  if (id) awEnsureButton();       // AniList rendert die Seite gern neu → Button ggf. erneut setzen
}, 1000);
