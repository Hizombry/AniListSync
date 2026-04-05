// background.js – Erweiterte Kommunikation mit Bewertungssystem

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRACK_EPISODE") {
    handleTrackEpisode(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === "RATE_ANIME") {
    handleRateAnime(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === "GET_ANIME_INFO") {
    handleGetAnimeInfo(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === "SAVE_LIST_ENTRY") {
    handleSaveListEntry(message.payload).then(sendResponse);
    return true;
  }
});

// ─────────────────────────────────────────────
// Anime-Info abrufen (mit mediaListEntry für integrierte Leiste)
// ─────────────────────────────────────────────
async function handleGetAnimeInfo({ title, season }) {
  const { anilistToken } = await chrome.storage.sync.get("anilistToken");
  const searchTitle = season === 1 ? title : `${title} Season ${season}`;

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        title { romaji english native }
        coverImage { large medium color }
        averageScore
        genres
        episodes
        status
        format
        season
        seasonYear
        description(asHtml: false)
        studios(isMain: true) { nodes { name } }
        nextAiringEpisode { episode timeUntilAiring }
        mediaListEntry { status score progress }
      }
    }
  `;

  const headers = { "Content-Type": "application/json" };
  if (anilistToken) headers["Authorization"] = `Bearer ${anilistToken}`;

  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables: { search: searchTitle } })
    });
    const data = await r.json();
    return { success: true, anime: data?.data?.Media };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
// Listen-Eintrag speichern (Status / Fortschritt / Score)
// ─────────────────────────────────────────────
async function handleSaveListEntry({ mediaId, status, progress, score }) {
  const { anilistToken } = await chrome.storage.sync.get("anilistToken");
  if (!anilistToken) return { success: false, error: "Token fehlt" };

  // Score ggf. in das richtige Format umrechnen
  let finalScore = score;
  if (score !== undefined) {
    const scoreFormat = await getUserScoreFormat(anilistToken);
    finalScore = formatScore(score, scoreFormat);
  }

  const query = `
    mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
        id status progress score
      }
    }
  `;

  const variables = { mediaId };
  if (status !== undefined)   variables.status   = status;
  if (progress !== undefined) variables.progress = progress;
  if (finalScore !== undefined) variables.score  = finalScore;

  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${anilistToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    const data = await r.json();
    if (data.errors) return { success: false, error: data.errors[0]?.message };
    return { success: true, entry: data?.data?.SaveMediaListEntry };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
// Score-Format
// ─────────────────────────────────────────────
function formatScore(score10, format) {
  switch (format) {
    case "POINT_100":        return score10 * 10;
    case "POINT_10_DECIMAL": return score10;
    case "POINT_10":         return score10;
    case "POINT_5":          return Math.round(score10 / 2);
    case "POINT_3":
      if (score10 <= 3) return 1;
      if (score10 <= 7) return 2;
      return 3;
    default: return score10;
  }
}

async function getUserScoreFormat(token) {
  const query = `query { Viewer { mediaListOptions { scoreFormat } } }`;
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await r.json();
    return data?.data?.Viewer?.mediaListOptions?.scoreFormat || "POINT_10";
  } catch {
    return "POINT_10";
  }
}

// ─────────────────────────────────────────────
// Bewertung absenden
// ─────────────────────────────────────────────
async function handleRateAnime({ title, season, score }) {
  const { anilistToken } = await chrome.storage.sync.get("anilistToken");
  if (!anilistToken) return { success: false, error: "Token fehlt" };

  const searchTitle = season === 1 ? title : `${title} Season ${season}`;
  const anime = await searchAnime(searchTitle, anilistToken);
  if (!anime) return { success: false, error: "Anime nicht gefunden" };

  const scoreFormat = await getUserScoreFormat(anilistToken);
  const finalScore = formatScore(score, scoreFormat);

  const query = `
    mutation ($mediaId: Int, $score: Float) {
      SaveMediaListEntry(mediaId: $mediaId, score: $score) { id score }
    }
  `;

  try {
    await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Authorization": `Bearer ${anilistToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { mediaId: anime.id, score: finalScore } })
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
// Tracking
// ─────────────────────────────────────────────
async function handleTrackEpisode({ title, season, episode }) {
  const { anilistToken } = await chrome.storage.sync.get("anilistToken");
  if (!anilistToken) return { success: false, error: "Token fehlt" };

  const searchTitle = season === 1 ? title : `${title} Season ${season}`;
  const anime = await searchAnime(searchTitle, anilistToken);
  if (!anime) return { success: false, error: "Anime nicht gefunden" };

  const totalEpisodes = anime.episodes || 0;
  const isCompleted = totalEpisodes > 0 && episode >= totalEpisodes;
  const status = isCompleted ? "COMPLETED" : "CURRENT";

  const currentProgress = await getCurrentProgress(anime.id, anilistToken);
  if (currentProgress !== null && currentProgress >= episode) {
    return { success: true, isCompleted };
  }

  const success = await saveToList(anime.id, episode, status, anilistToken);
  return { success, isCompleted };
}

// ─────────────────────────────────────────────
// Hilfsfunktionen
// ─────────────────────────────────────────────
async function searchAnime(title, token) {
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) { id title { romaji english } episodes }
    }
  `;
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { search: title } })
    });
    const data = await r.json();
    return data?.data?.Media;
  } catch { return null; }
}

async function getCurrentProgress(mediaId, token) {
  const query = `query ($mediaId: Int) { MediaList(mediaId: $mediaId) { progress } }`;
  try {
    const r = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { mediaId } })
    });
    const data = await r.json();
    return data?.data?.MediaList?.progress;
  } catch { return null; }
}

async function saveToList(mediaId, progress, status, token) {
  const query = `
    mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress) { id }
    }
  `;
  try {
    await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { mediaId, status, progress } })
    });
    return true;
  } catch { return false; }
}
