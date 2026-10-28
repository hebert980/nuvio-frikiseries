/*
 * Nuvio FrikiSeries — adaptación comunitaria del proveedor de Kino.
 * Referencia: https://github.com/stanpx/kino-plugin-frikiseries
 *
 * Esta adaptación consulta los datos públicos del catálogo del proyecto original,
 * usa TMDB para convertir el TMDB ID de Nuvio a un título y resuelve enlaces directos
 * MP4/HLS o OK.ru cuando la fuente los ofrece.
 *
 * Antes de redistribuir, comprueba la licencia y conserva los avisos del proyecto fuente.
 */

const PROVIDER = "FrikiSeries";
const BASE = "https://www.frikiserie.com";
const INFO_URL = "https://www.frikiserie.com/assets/data/info.json";
const EPISODES_URL = "https://raw.githubusercontent.com/stanpx/kino-plugin-frikiseries/main/episodes/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const OK_HEADERS = { "User-Agent": USER_AGENT, "Referer": "https://ok.ru/" };
let infoCache = null;
const episodeCache = {};

function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function normKey(s) { return normalize(s).replace(/[^a-z0-9]/g, ""); }
function htmlDecode(s) {
  return String(s || "").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function validHttpUrl(s) { return typeof s === "string" && /^https?:\/\//i.test(s); }
async function fetchJson(url, headers) {
  const res = await fetch(url, { headers: headers || { "Accept": "application/json" } });
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "sin respuesta"));
  return await res.json();
}
async function getTmdbMeta(tmdbId, mediaType, apiKey) {
  if (!apiKey) throw new Error("Falta la TMDB API key. Abre Ajustes del proveedor FrikiSeries.");
  const type = mediaType === "movie" ? "movie" : "tv";
  const url = "https://api.themoviedb.org/3/" + type + "/" +
    encodeURIComponent(String(tmdbId)) + "?api_key=" + encodeURIComponent(apiKey) + "&language=es-419";
  return await fetchJson(url);
}
async function getInfo() {
  if (infoCache) return infoCache;
  const data = await fetchJson(INFO_URL);
  const rows = Array.isArray(data && data.info) ? data.info : (Array.isArray(data) ? data : []);
  infoCache = rows;
  return rows;
}
function titleOfMeta(meta, mediaType) {
  return mediaType === "movie" ? (meta.title || meta.original_title || "") : (meta.name || meta.original_name || "");
}
function scoreItem(item, titleCandidates, year) {
  const title = normalize(item.titulo || item.title || "");
  if (!title) return 0;
  let score = 0;
  titleCandidates.forEach(c => {
    const n = normalize(c);
    if (!n) return;
    if (title === n) score = Math.max(score, 100);
    else if (title.startsWith(n) || n.startsWith(title)) score = Math.max(score, 72);
    else if (title.includes(n) || n.includes(title)) score = Math.max(score, 45);
  });
  const itemYear = parseInt(String(item.fecha || "").slice(0,4),10);
  if (year && itemYear && year === itemYear && score) score += 12;
  return score;
}
async function findCatalogItem(tmdbMeta, mediaType) {
  const mainTitle = titleOfMeta(tmdbMeta, mediaType);
  const original = mediaType === "movie" ? tmdbMeta.original_title : tmdbMeta.original_name;
  const yearRaw = mediaType === "movie" ? tmdbMeta.release_date : tmdbMeta.first_air_date;
  const year = parseInt(String(yearRaw || "").slice(0,4),10) || null;
  const candidates = [mainTitle, original].filter(Boolean);
  const rows = await getInfo();
  const ranked = rows.map(item => ({item, score: scoreItem(item, candidates, year)}))
    .filter(x => x.score >= 72).sort((a,b) => b.score-a.score);
  if (!ranked.length) return null;
  // Evita elegir un título homónimo si dos resultados tienen la misma puntuación.
  if (ranked.length > 1 && ranked[0].score === ranked[1].score &&
      normalize(ranked[0].item.titulo) !== normalize(ranked[1].item.titulo)) return null;
  const selected = ranked[0].item;
  if (mediaType === "movie" && selected.tipo && selected.tipo !== "pelicula") return null;
  if (mediaType === "tv" && selected.tipo === "pelicula") return null;
  return selected;
}
async function getEpisodesForItem(item) {
  const title = item.titulo || "";
  const slug = item.slug || title;
  const titleKey = normKey(title), slugKey = normKey(slug);
  const prefix = (titleKey || slugKey).charAt(0);
  if (!prefix) return [];
  if (!episodeCache[prefix]) {
    episodeCache[prefix] = fetchJson(EPISODES_URL + encodeURIComponent(prefix) + ".json")
      .catch(() => ({}));
  }
  const data = await episodeCache[prefix];
  const list = data[titleKey] || data[slugKey] || [];
  return Array.isArray(list) ? list : [];
}
function streamObject(url, quality, title) {
  return {
    name: PROVIDER + (quality ? " · " + quality : ""),
    title: title || PROVIDER,
    url,
    quality: quality || (url.includes(".m3u8") ? "HLS" : "MP4"),
    headers: url.includes("ok.ru") || url.includes("okcdn.ru") ? OK_HEADERS : { "User-Agent": USER_AGENT },
    provider: "frikiseries"
  };
}
async function resolveOkru(videoUrl, mediaTitle) {
  let embed = videoUrl;
  const id = videoUrl.match(/video(?:embed)?\/(\d+)/);
  if (id) embed = "https://ok.ru/videoembed/" + id[1];
  else if (videoUrl.includes("/video/")) embed = videoUrl.replace("/video/", "/videoembed/");
  embed = embed.replace("m.ok.ru", "ok.ru");
  const res = await fetch(embed, { headers: { "User-Agent": USER_AGENT } });
  if (!res || !res.ok) return [];
  const html = await res.text();
  if (html.includes("vp_video_stub_txt") || html.includes("userNotFound")) return [];
  const match = html.match(/data-options="([^"]+)"/) || html.match(/data-options='([^']+)'/);
  if (!match) return [];
  let options;
  try { options = JSON.parse(htmlDecode(match[1])); } catch (_) { return []; }
  const flashvars = options.flashvars || {};
  let metadata = flashvars.metadata;
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch (_) { metadata = null; }
  }
  if (!metadata || metadata.error) return [];
  const videos = Array.isArray(metadata.videos) ? metadata.videos : [];
  const order = ["hd","sd","full","low","lowest","mobile"];
  videos.sort((a,b) => {
    const ai = order.indexOf(String(a.name || "").toLowerCase());
    const bi = order.indexOf(String(b.name || "").toLowerCase());
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const out = [];
  videos.forEach(v => {
    if (validHttpUrl(v.url)) {
      const q = String(v.name || "MP4").toUpperCase();
      if (!out.some(s => s.url === v.url)) out.push(streamObject(v.url, q, (mediaTitle || PROVIDER) + " · " + q));
    }
  });
  if (validHttpUrl(metadata.hlsManifestUrl) && !out.some(s => s.url === metadata.hlsManifestUrl)) {
    out.push(streamObject(metadata.hlsManifestUrl, "HLS", (mediaTitle || PROVIDER) + " · HLS"));
  }
  return out.slice(0,8);
}
async function resolveVideo(url, title) {
  if (!validHttpUrl(url) || url === "xxx" || url === "xxxx") return [];
  if (url.includes("ok.ru")) return await resolveOkru(url, title);
  if (url.includes("vk.com") || url.includes("vkvideo.ru")) return [];
  // Solo se devuelven archivos directos reproducibles, no páginas HTML de embed.
  if (/\.m3u8(?:$|[?#])/i.test(url)) return [streamObject(url, "HLS", title)];
  if (/\.mp4(?:$|[?#])/i.test(url) || url.includes("archive.org/download/")) return [streamObject(url, "MP4", title)];
  return [];
}
async function onSettings() {
  return [
    { type: "header", label: "Configuración de FrikiSeries" },
    { type: "text", key: "tmdbApiKey", label: "TMDB API key", placeholder: "Introduce tu clave API de TMDB", isPassword: true },
    { type: "info", label: "Necesaria para convertir el ID de Nuvio en el título usado por el catálogo de FrikiSeries." }
  ];
}
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const settings = globalThis.SCRAPER_SETTINGS || {};
    const apiKey = String(settings.tmdbApiKey || settings.apiKey || "").trim();
    if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) return [];
    const meta = await getTmdbMeta(tmdbId, mediaType, apiKey);
    const item = await findCatalogItem(meta, mediaType);
    if (!item) {
      console.log("[FrikiSeries] No hubo coincidencia segura en el catálogo para TMDB ID " + tmdbId);
      return [];
    }
    const title = item.titulo || titleOfMeta(meta, mediaType) || PROVIDER;
    const video = item.video;
    if (mediaType === "movie") return await resolveVideo(video, title);

    const needsEpisodeList = item.irAListaVideo === true || !video || video === "xxx" || video === "xxxx" || !validHttpUrl(video);
    if (needsEpisodeList) {
      const episodes = await getEpisodesForItem(item);
      const wantedSeason = Number(season || 1);
      const wantedEpisode = Number(episode || 1);
      const found = episodes.find(ep => Number(ep.s || 1) === wantedSeason && Number(ep.n) === wantedEpisode);
      if (!found || !validHttpUrl(found.v)) return [];
      return await resolveVideo(found.v, title + " · T" + wantedSeason + "E" + wantedEpisode + (found.t ? " · " + found.t : ""));
    }
    // Los maratones son un único archivo completo: no fingir que contiene episodios separados.
    if (Number(season || 1) !== 1 || Number(episode || 1) !== 1) return [];
    return await resolveVideo(video, title + " · Maratón completo");
  } catch (e) {
    console.log("[FrikiSeries] " + (e && e.message ? e.message : String(e)));
    return [];
  }
}
module.exports = { getStreams, onSettings };
