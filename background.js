// background.js – AniList-Kommunikation
// Läuft als Service Worker (Chrome MV3) bzw. Event-Page (Firefox).

const API_URL = "https://graphql.anilist.co";
const TV_FORMATS = ["TV", "TV_SHORT", "ONA"];

// ─────────────────────────────────────────────
// Storage (Token liegt lokal, nicht in storage.sync)
// ─────────────────────────────────────────────
async function getToken() {
  const local = await chrome.storage.local.get("anilistToken");
  if (local.anilistToken) return local.anilistToken;

  // Migration: frühere Versionen haben den Token in storage.sync gespeichert
  try {
    const sync = await chrome.storage.sync.get("anilistToken");
    if (sync.anilistToken) {
      await chrome.storage.local.set({ anilistToken: sync.anilistToken });
      await chrome.storage.sync.remove("anilistToken");
      return sync.anilistToken;
    }
  } catch { /* sync nicht verfügbar */ }
  return "";
}

// ─────────────────────────────────────────────
// GraphQL-Helfer: wirft bei HTTP- UND GraphQL-Fehlern
// ─────────────────────────────────────────────
async function anilistRequest(query, variables, token) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const r = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (r.status === 429) throw new Error("AniList Rate-Limit erreicht – bitte kurz warten.");

  let json;
  try { json = await r.json(); }
  catch { throw new Error(`Ungültige AniList-Antwort (HTTP ${r.status})`); }

  if (json.errors?.length) {
    const msg = json.errors[0].message || "AniList-Fehler";
    throw new Error(r.status === 400 && /invalid token/i.test(msg) ? "AniList-Token ungültig" : msg);
  }
  if (!r.ok) throw new Error(`AniList HTTP ${r.status}`);
  return json.data;
}

// ─────────────────────────────────────────────
// Score-Format des Nutzers
// ─────────────────────────────────────────────
let scoreFormatCache = { token: null, format: null };

async function getUserScoreFormat(token) {
  if (scoreFormatCache.token === token && scoreFormatCache.format) return scoreFormatCache.format;
  try {
    const data = await anilistRequest(
      "query { Viewer { mediaListOptions { scoreFormat } } }", {}, token
    );
    const format = data?.Viewer?.mediaListOptions?.scoreFormat || "POINT_10";
    scoreFormatCache = { token, format };
    return format;
  } catch {
    return "POINT_10";
  }
}

function formatScore(score10, format) {
  switch (format) {
    case "POINT_100":        return score10 * 10;
    case "POINT_10_DECIMAL": return score10;
    case "POINT_10":         return Math.round(score10);
    case "POINT_5":          return Math.round(score10 / 2);
    case "POINT_3":
      if (score10 <= 3) return 1;
      if (score10 <= 7) return 2;
      return 3;
    default: return score10;
  }
}

// ─────────────────────────────────────────────
// Anime-Zuordnung: AniWorld (Titel/Staffel/Episode) → AniList-Eintrag
// ─────────────────────────────────────────────
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["the", "season", "staffel", "part", "cour"]);

function tokens(s) {
  return new Set(normalize(s).split(" ").filter(t => t && !STOPWORDS.has(t)));
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return (2 * common) / (a.size + b.size);
}

function scoreCandidate(media, titles, season, index) {
  const names = [media.title?.romaji, media.title?.english, ...(media.synonyms || [])].filter(Boolean);

  let best = 0;
  for (const q of titles) {
    // Bei Staffel ≥ 2 zählt die Staffelnummer als Suchbegriff mit
    const qt = tokens(season > 1 ? `${q} ${season}` : q);
    for (const n of names) best = Math.max(best, dice(qt, tokens(n)));
  }

  const hasPrequel = (media.relations?.edges || []).some(
    e => e.relationType === "PREQUEL" && TV_FORMATS.includes(e.node?.format)
  );

  if (season <= 1 && !hasPrequel) best += 0.1;
  if (season > 1) {
    if (names.some(n => tokens(n).has(String(season)))) best += 0.15;
    best += hasPrequel ? 0.05 : -0.2;   // ohne Prequel = erste Staffel, passt nicht zu Staffel ≥ 2
  }
  if (!TV_FORMATS.includes(media.format)) best -= 0.3;   // Movies/OVAs/Specials abwerten
  return best - index * 0.001;                           // bei Gleichstand: AniList-Reihenfolge
}

async function findCandidates(titles, season, token) {
  const query = `
    query ($search: String) {
      Page(perPage: 10) {
        media(search: $search, type: ANIME) {
          id episodes format synonyms
          title { romaji english }
          relations { edges { relationType node { id format } } }
        }
      }
    }`;
  const map = new Map();
  for (const t of titles) {
    const search = season > 1 ? `${t} Season ${season}` : t;
    const data = await anilistRequest(query, { search }, token);
    for (const m of data?.Page?.media || []) if (!map.has(m.id)) map.set(m.id, m);
  }
  return [...map.values()];
}

// ── Vollständige Media-Daten (mit Relations), kurz gecacht ──
const FULL_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id episodes format status
      startDate { year month day }
      title { romaji english }
      synonyms
      relations {
        edges {
          relationType
          node {
            id episodes format status
            startDate { year month day }
            title { romaji english }
            synonyms
          }
        }
      }
    }
  }`;

const mediaCache = new Map();
const MEDIA_TTL_MS = 60 * 60 * 1000;

async function getFull(id, token) {
  const hit = mediaCache.get(id);
  if (hit && Date.now() - hit.ts < MEDIA_TTL_MS) return hit.media;

  const data = await anilistRequest(FULL_QUERY, { id }, token);
  const media = data?.Media || null;
  if (media) {
    if (mediaCache.size > 300) mediaCache.clear();
    mediaCache.set(id, { ts: Date.now(), media });
  }
  return media;
}

// ── Sequel-Kette ──
const TIER_SERIES = ["TV", "TV_SHORT", "ONA"];
const TIER_EXTRA  = ["OVA", "SPECIAL", "TV_SPECIAL"];   // z.B. AoT: letzte „Episoden" sind Specials
const MAX_CHAIN = 15;

function dateKey(node) {
  const d = node?.startDate;
  return d?.year ? d.year * 10000 + (d.month || 0) * 100 + (d.day || 0) : 99999999;
}

// Nächster Eintrag: erst Serien-Formate, wenn es keine gibt OVAs/Specials
function pickSequel(media, tiers = [TIER_SERIES, TIER_EXTRA]) {
  const edges = (media.relations?.edges || []).filter(e => e.relationType === "SEQUEL" && e.node);
  for (const tier of tiers) {
    const c = edges
      .filter(e => tier.includes(e.node.format))
      .sort((x, y) => dateKey(x.node) - dateKey(y.node) || x.node.id - y.node.id);
    if (c.length) return c[0];
  }
  return null;
}

async function findBase(titles, token) {
  const candidates = await findCandidates(titles, 1, token);
  if (!candidates.length) return null;
  return candidates
    .map((m, i) => ({ m, s: scoreCandidate(m, titles, 1, i) }))
    .sort((a, b) => b.s - a.s)[0].m;
}

// Episode einer AniWorld-Staffel → AniList-Eintrag.
//
// AniWorld und AniList teilen Serien unterschiedlich auf (Gintama: viele AniWorld-Staffeln
// liegen in EINEM AniList-Eintrag; AoT: Specials erscheinen als normale Episoden).
// Deshalb wird die Position fortlaufend gezählt:
//   absolut = (Episoden aller früheren AniWorld-Staffeln) + Episode
// und diese Zahl an der AniList-Sequel-Kette „abgewickelt".
async function resolveEpisode(baseFull, { season = 1, episode = 1, priorEpisodes = null }, token) {
  episode = episode || 1;
  const chain = [baseFull];

  const ensure = async (n) => {
    while (chain.length < n) {
      if (chain.length >= MAX_CHAIN) return false;
      const next = pickSequel(chain[chain.length - 1]);
      if (!next) return false;
      const full = await getFull(next.node.id, token);
      if (!full) return false;
      chain.push(full);
    }
    return true;
  };

  let p = priorEpisodes;
  if (p == null) {
    // Episodenzahlen früherer Staffeln unbekannt → Annahme: AniWorld-Staffeln = AniList-Einträge
    p = 0;
    for (let j = 0; j < Math.max(0, season - 1); j++) {
      if (!(await ensure(j + 1))) break;
      p += chain[j].episodes || 0;
    }
  } else if (p > 0) {
    // Kleine Abweichungen (fehlende/zusätzliche Episoden auf AniWorld) an Eintragsgrenzen einrasten
    let cum = 0;
    for (let j = 0; ; j++) {
      if (!(await ensure(j + 1))) break;
      const total = chain[j].episodes || 0;
      if (!total) break;
      cum += total;
      const tol = Math.min(3, Math.max(1, Math.floor(total / 4)));   // höchstens 3 Folgen Abweichung
      if (Math.abs(p - cum) <= tol) { p = cum; break; }
      if (cum > p + tol) break;
    }
  }

  let idx = p + episode;
  for (let j = 0; ; j++) {
    const m = chain[j];
    const total = m.episodes || 0;
    if (!total || idx <= total) return { media: m, episode: idx, overflow: false };
    idx -= total;
    if (!(await ensure(j + 2))) return { media: m, episode: idx + total, overflow: true };
  }
}

// ── Filme-Tab: MOVIE/OVA/ONA/SPECIAL des Franchise suchen ──
const FILM_FORMATS = ["MOVIE", "OVA", "SPECIAL", "TV_SPECIAL", "ONA"];
const CRAWL_RELATIONS = new Set(["SEQUEL", "PREQUEL", "SIDE_STORY", "SUMMARY", "PARENT", "ALTERNATIVE"]);
const MAX_CRAWL = 14;

async function collectFranchise(baseFull, token) {
  const nodes = new Map();                      // id → Node aus den Relations
  const full  = new Map([[baseFull.id, baseFull]]);
  const queue = [baseFull];
  let fetches = 0;

  while (queue.length) {
    const m = queue.shift();
    for (const e of m.relations?.edges || []) {
      if (!e.node || !CRAWL_RELATIONS.has(e.relationType)) continue;
      const id = e.node.id;
      if (id === baseFull.id || nodes.has(id)) continue;
      nodes.set(id, e.node);
      if (fetches >= MAX_CRAWL) continue;
      fetches++;
      const f = await getFull(id, token);
      if (f) { full.set(id, f); queue.push(f); }
    }
  }
  return { nodes, full };
}

// Token ohne die Wörter des Serientitels (und ohne „Film 1"): Nur das, was den Film
// unterscheidet, zählt. Sonst blähen gemeinsame Serienwörter jede Ähnlichkeit auf und ein
// Titel, der nur den Serienname enthält, würde irgendeinen Eintrag „erraten".
function residual(str, seriesTokens) {
  const clean = String(str || "").replace(/\bfilm\s*\d+\b/gi, " ");
  return new Set([...tokens(clean)].filter(t => !seriesTokens.has(t)));
}

function filmSimilarity(node, awTitles, seriesTokens) {
  const names = [node.title?.romaji, node.title?.english, ...(node.synonyms || [])].filter(Boolean);
  let best = 0;
  for (const q of awTitles) {
    const qt = residual(q, seriesTokens);
    if (!qt.size) continue;            // nur Serienname → sagt nichts über diesen Film
    for (const n of names) best = Math.max(best, dice(qt, residual(n, seriesTokens)));
  }
  return best;
}

async function resolveFilm(baseFull, payload, token) {
  const { episode: filmNumber = 1, filmTitles = [], filmCount = 0 } = payload;
  const { nodes, full } = await collectFranchise(baseFull, token);

  // Einträge, die schon als normale Staffeln laufen, sind keine Filme
  const claimed = new Set([baseFull.id]);
  let cur = baseFull;
  for (let i = 0; i < MAX_CHAIN && cur; i++) {
    const next = pickSequel(cur, [TIER_SERIES]);
    if (!next) break;
    claimed.add(next.node.id);
    cur = full.get(next.node.id);
  }

  const cands = [...nodes.values()]
    .filter(n => FILM_FORMATS.includes(n.format) && !claimed.has(n.id))
    .sort((x, y) => dateKey(x) - dateKey(y) || x.id - y.id);
  if (!cands.length) return null;

  let pick = null;

  // 1. Über den Filmtitel von AniWorld
  const awTitles = (filmTitles || []).filter(Boolean);
  const seriesTokens = new Set([
    payload.title, payload.altTitle, baseFull.title?.romaji, baseFull.title?.english,
  ].flatMap(t => [...tokens(t || "")]));
  if (awTitles.length) {
    const ranked = cands.map(n => ({ n, s: filmSimilarity(n, awTitles, seriesTokens) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s >= 0.5 && (ranked.length === 1 || ranked[0].s - ranked[1].s >= 0.05)) pick = ranked[0].n;
  }

  // 2. Reihenfolge nach Erscheinungsdatum – nur wenn die Anzahl exakt passt
  if (!pick && filmCount && filmCount === cands.length) pick = cands[filmNumber - 1] || null;

  if (!pick) return null;
  return { media: pick, episode: pick.episodes || 1, overflow: false };
}

async function resolveMedia(payload, token) {
  const titles = [...new Set([payload.title, payload.altTitle].filter(Boolean))];
  if (!titles.length) return null;

  const base = await findBase(titles, token);
  if (!base) return null;
  const baseFull = await getFull(base.id, token);
  if (!baseFull) return null;

  return payload.pageType === "film"
    ? resolveFilm(baseFull, payload, token)
    : resolveEpisode(baseFull, payload, token);
}

// ─────────────────────────────────────────────
// Listen-Eintrag schreiben
// ─────────────────────────────────────────────
async function saveEntry(token, { mediaId, status, progress, score }) {
  const query = `
    mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
      SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
        id status progress score
      }
    }`;
  const variables = { mediaId };
  if (status !== undefined)   variables.status   = status;
  if (progress !== undefined) variables.progress = progress;
  if (score !== undefined)    variables.score    = formatScore(score, await getUserScoreFormat(token));

  const data = await anilistRequest(query, variables, token);
  return data?.SaveMediaListEntry;
}

// ─────────────────────────────────────────────
// Message-Handler
// ─────────────────────────────────────────────
const INFO_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id title { romaji english native }
      coverImage { large medium color }
      averageScore genres episodes status format season seasonYear
      description(asHtml: false)
      studios(isMain: true) { nodes { name } }
      nextAiringEpisode { episode timeUntilAiring }
      mediaListEntry { status score progress }
    }
  }`;

async function handleGetAnimeInfo(payload) {
  const token = await getToken();
  const resolved = await resolveMedia(payload, token);
  if (!resolved) {
    return {
      success: true,
      anime: null,
      reason: payload.pageType === "film" ? "Film konnte auf AniList nicht eindeutig zugeordnet werden" : "",
    };
  }

  const data = await anilistRequest(INFO_QUERY, { id: resolved.media.id }, token);
  const scoreFormat = token ? await getUserScoreFormat(token) : "POINT_10";
  return { success: true, anime: data?.Media || null, episode: resolved.episode, scoreFormat };
}

async function handleSaveListEntry({ mediaId, status, progress, score }) {
  const token = await getToken();
  if (!token) return { success: false, error: "Token fehlt" };
  if (!mediaId) return { success: false, error: "Anime-ID fehlt" };
  const entry = await saveEntry(token, { mediaId, status, progress, score });
  return { success: true, entry };
}

async function handleRateAnime(payload) {
  const { mediaId, score } = payload;
  const token = await getToken();
  if (!token) return { success: false, error: "Token fehlt" };

  let id = mediaId;
  if (!id) {
    const resolved = await resolveMedia(payload, token);
    if (!resolved) return { success: false, error: "Anime nicht gefunden" };
    id = resolved.media.id;
  }
  const entry = await saveEntry(token, { mediaId: id, score });
  return { success: true, entry };
}

async function handleTrackEpisode(payload) {
  const { mediaId, resolvedEpisode } = payload;
  const token = await getToken();
  if (!token) return { success: false, error: "Token fehlt" };

  // Bevorzugt die bereits aufgelöste ID/Episode aus dem Content-Script
  let id = mediaId;
  let ep = resolvedEpisode;
  if (!id || ep == null) {
    const resolved = await resolveMedia(payload, token);
    if (!resolved) return { success: false, error: "Anime nicht gefunden" };
    id = resolved.media.id;
    ep = resolved.episode;
  }

  const data = await anilistRequest(
    `query ($id: Int) { Media(id: $id, type: ANIME) { id episodes mediaListEntry { status progress } } }`,
    { id }, token
  );
  const media = data?.Media;
  if (!media) return { success: false, error: "Anime nicht gefunden" };

  const total = media.episodes || 0;
  if (total > 0 && ep > total) ep = total;
  const isCompleted = total > 0 && ep >= total;
  const current = media.mediaListEntry;

  if (current && current.progress >= ep) {
    return { success: true, isCompleted, progress: current.progress, skipped: true };
  }

  let status = isCompleted ? "COMPLETED" : "CURRENT";
  if (!isCompleted && current?.status === "REPEATING") status = "REPEATING";

  const saved = await saveEntry(token, { mediaId: id, status, progress: ep });
  return { success: true, isCompleted, progress: saved?.progress ?? ep };
}

// ─────────────────────────────────────────────
// AniList → AniWorld (QuickLink auf anilist.co)
// ─────────────────────────────────────────────
const AW_ORIGIN = "https://aniworld.to";
const AW_TTL_MS = 3 * 24 * 60 * 60 * 1000;

async function awCacheGet(key) {
  try {
    const o = await chrome.storage.local.get(key);
    const v = o[key];
    if (v && Date.now() - v.ts < AW_TTL_MS) return v.data;
  } catch { /* ignorieren */ }
  return null;
}

async function awCacheSet(key, data) {
  try { await chrome.storage.local.set({ [key]: { ts: Date.now(), data } }); } catch { /* ignorieren */ }
}

// Vorgänger-Eintrag (neuester früherer Eintrag der gewünschten Formate)
function pickPrequel(media, formats = TV_FORMATS) {
  const edges = (media.relations?.edges || [])
    .filter(e => e.relationType === "PREQUEL" && e.node && formats.includes(e.node.format))
    .sort((x, y) => dateKey(y.node) - dateKey(x.node) || y.node.id - x.node.id);
  return edges[0] || null;
}

// Wurzel der Reihe + Summe der Episoden aller TV-Vorgänger
async function findRootAndPrior(media) {
  let cur = media;
  const isSeries = TV_FORMATS.includes(media.format);

  // Film/OVA/Special: erst zum Eltern-Eintrag bzw. irgendeinem Vorgänger springen
  if (!isSeries) {
    const e = (media.relations?.edges || []).find(x => x.relationType === "PARENT" && x.node)
           || (media.relations?.edges || []).find(x => x.relationType === "PREQUEL" && x.node);
    if (e) cur = (await getFull(e.node.id, "")) || media;
  }

  let prior = 0;
  for (let i = 0; i < MAX_CHAIN; i++) {
    const e = pickPrequel(cur);
    if (!e) break;
    const f = await getFull(e.node.id, "");
    if (!f) break;
    prior += f.episodes || 0;
    cur = f;
  }
  return { root: cur, prior: isSeries ? prior : null, isSeries };
}

// AniWorld-Suche (POST /ajax/search, Antwort: JSON-Liste mit link + title)
async function awSearch(keyword) {
  const r = await fetch(`${AW_ORIGIN}/ajax/search`, {
    method: "POST",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/javascript, */*",
    },
    body: new URLSearchParams({ keyword }).toString(),
  });
  if (!r.ok) throw new Error(`AniWorld HTTP ${r.status}`);

  let list;
  try { list = JSON.parse(await r.text()); } catch { return []; }
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const it of list) {
    const m = String(it?.link || "").match(/anime\/stream\/([^/?#]+)/);
    if (!m || /episode-/.test(String(it.link)) || seen.has(m[1])) continue;
    seen.add(m[1]);
    const title = String(it.title || it.name || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ slug: m[1], title });
  }
  return out;
}

function awMatchScore(result, names) {
  const rt = tokens(result.title || result.slug.replace(/-/g, " "));
  const st = tokens(result.slug.replace(/-/g, " "));
  let best = 0;
  for (const n of names) {
    const nt = tokens(n);
    best = Math.max(best, dice(rt, nt), dice(st, nt));
  }
  return best;
}

async function awFindSeries(root) {
  const names = [root.title?.romaji, root.title?.english, ...(root.synonyms || [])].filter(Boolean);
  const keywords = [...new Set([root.title?.english, root.title?.romaji].filter(Boolean))];

  for (const kw of keywords.slice(0, 2)) {
    const results = await awSearch(kw);
    const ranked = results
      .map(r => ({ r, s: awMatchScore(r, names) }))
      .sort((a, b) => b.s - a.s);
    if (ranked.length && ranked[0].s >= 0.6) return ranked[0].r;
  }
  return null;
}

// Höchste Episodennummer einer AniWorld-Staffel (null = Staffel existiert nicht)
async function awSeasonCount(slug, n) {
  const key = `aw:count:${slug}:${n}`;           // gleicher Schlüssel wie content.js
  const cached = await awCacheGet(key);
  if (cached) return cached;

  const r = await fetch(`${AW_ORIGIN}/anime/stream/${slug}/staffel-${n}`);
  if (!r.ok) return null;
  const html = await r.text();
  const re = new RegExp(`/anime/stream/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/staffel-${n}/episode-(\\d+)`, "g");
  let max = 0;
  for (const m of html.matchAll(re)) max = Math.max(max, parseInt(m[1], 10));
  if (!max) return null;

  await awCacheSet(key, max);
  return max;
}

// AniList-Position (Episoden davor) → AniWorld-Staffel
async function awResolveSeason(slug, prior) {
  let cum = 0, pick = 1;
  for (let n = 1; n <= MAX_CHAIN + 5; n++) {
    const c = await awSeasonCount(slug, n);
    if (!c) break;
    const tol = Math.min(3, Math.max(1, Math.floor(c / 4)));   // wie in resolveEpisode
    if (cum <= prior + tol) pick = n; else break;
    cum += c;
  }
  return pick;
}

async function handleFindAniWorld({ mediaId }) {
  if (!mediaId) return { success: false, error: "Anime-ID fehlt" };

  const key = `al2aw:${mediaId}`;
  const cached = await awCacheGet(key);
  if (cached) return { success: true, found: true, ...cached };

  const media = await getFull(mediaId, "");
  if (!media) return { success: true, found: false };

  const { root, prior, isSeries } = await findRootAndPrior(media);
  const series = await awFindSeries(root);
  if (!series) {
    const q = media.title?.english || media.title?.romaji || "";
    return { success: true, found: false, searchUrl: `${AW_ORIGIN}/search?q=${encodeURIComponent(q)}` };
  }

  const base = `${AW_ORIGIN}/anime/stream/${series.slug}`;
  let data;
  if (isSeries) {
    const season = await awResolveSeason(series.slug, prior || 0);
    data = { url: `${base}/staffel-${season}`, slug: series.slug, season, kind: "season" };
  } else {
    data = { url: `${base}/filme`, slug: series.slug, season: null, kind: "film" };
  }

  await awCacheSet(key, data);
  return { success: true, found: true, ...data };
}

const HANDLERS = {
  TRACK_EPISODE: handleTrackEpisode,
  RATE_ANIME: handleRateAnime,
  GET_ANIME_INFO: handleGetAnimeInfo,
  SAVE_LIST_ENTRY: handleSaveListEntry,
  FIND_ANIWORLD: handleFindAniWorld,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  handler(message.payload || {})
    .then(sendResponse)
    .catch(e => {
      console.error("[Tracker]", message.type, e);
      sendResponse({ success: false, error: e?.message || String(e) });
    });
  return true; // asynchrone Antwort
});
