import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const app = express();
app.use(cors());
app.use(express.json());

const SERVICE_SPECS = {
  sonarr: { url: process.env.SONARR_URL, apiKey: process.env.SONARR_API_KEY },
  radarr: { url: process.env.RADARR_URL, apiKey: process.env.RADARR_API_KEY },
  lidarr: { url: process.env.LIDARR_URL, apiKey: process.env.LIDARR_API_KEY },
  readarr: { url: process.env.READARR_URL, apiKey: process.env.READARR_API_KEY },
  prowlarr: { url: process.env.PROWLARR_URL, apiKey: process.env.PROWLARR_API_KEY },
  bazarr: { url: process.env.BAZARR_URL, apiKey: process.env.BAZARR_API_KEY }
};
const ALL_SERVICES = Object.keys(SERVICE_SPECS);
const OVERVIEW_SERVICES = [...ALL_SERVICES, "qbittorrent"];
const SERVICE_API_BASE = {
  sonarr: "/api/v3",
  radarr: "/api/v3",
  lidarr: "/api/v1",
  readarr: "/api/v1",
  prowlarr: "/api/v1",
  bazarr: "/api"
};
const QBT_CONFIG = {
  url: process.env.QBITTORRENT_URL || "",
  username: process.env.QBITTORRENT_USERNAME || "",
  password: process.env.QBITTORRENT_PASSWORD || ""
};

const CATEGORY_TO_SERVICES = {
  tv: ["sonarr"],
  movies: ["radarr"],
  music: ["lidarr"]
};

const configuredServices = Object.entries(SERVICE_SPECS)
  .filter(([, cfg]) => cfg.url && cfg.apiKey)
  .reduce((acc, [name, cfg]) => {
    acc[name] = cfg;
    return acc;
  }, {});

function normalizeUrl(url) {
  return url.replace(/\/+$/, "");
}

async function requestArr(serviceName, endpoint) {
  const service = configuredServices[serviceName];
  if (!service) {
    throw new Error(`Service ${serviceName} is not configured`);
  }

  const res = await fetch(`${normalizeUrl(service.url)}${endpoint}`, {
    headers: {
      "X-Api-Key": service.apiKey,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${serviceName}: ${res.status} ${text.slice(0, 120)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`${serviceName}: non-JSON response (${text.slice(0, 120)})`);
  }
  return res.json();
}

async function requestArrWithFallback(serviceName, endpoints) {
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      return await requestArr(serviceName, endpoint);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`${serviceName}: no endpoint available`);
}

function getPrimaryBase(serviceName) {
  return SERVICE_API_BASE[serviceName] || "/api/v1";
}

function getStatusEndpoints(serviceName) {
  const primaryBase = getPrimaryBase(serviceName);
  const primary = `${primaryBase}/system/status`;
  const fallback = serviceName === "bazarr" ? "/api/v1/system/status" : "/api/system/status";
  return [primary, fallback];
}

function getQueueEndpoints(serviceName) {
  const base = getPrimaryBase(serviceName);
  return [
    `${base}/queue?page=1&pageSize=50&sortKey=timeleft&sortDirection=ascending`
  ];
}

function getLogEndpoints(serviceName) {
  const base = getPrimaryBase(serviceName);
  if (serviceName === "bazarr") {
    return [`${base}/system/logs?page=1&pageSize=250`];
  }
  return [
    `${base}/log?sortKey=time&sortDirection=descending&page=1&pageSize=250`
  ];
}

function normalizeLogEntry(service, item) {
  const level = String(item.level || "info").toLowerCase();
  return {
    service,
    level,
    message: item.message || item.exception || item.logger || "No message",
    time: item.time || item.timestamp || null
  };
}

function extractYear(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d{4}$/.test(value)) return Number(value);
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getUTCFullYear();
  }
  return null;
}

function buildAssetUrl(serviceName, rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) return rawUrl;
  const cfg = configuredServices[serviceName];
  if (!cfg) return null;
  return `${normalizeUrl(cfg.url)}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`;
}

function pickPosterUrl(serviceName, item) {
  const images = Array.isArray(item?.images) ? item.images : [];
  const poster = images.find((img) => img.coverType === "poster") || images[0];
  if (!poster) return null;
  return buildAssetUrl(serviceName, poster.remoteUrl || poster.url || null);
}

function roundTwo(value) {
  return Math.round(value * 100) / 100;
}

function bytesToGb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return roundTwo(bytes / (1024 * 1024 * 1024));
}

function normalizeHash(value) {
  return String(value || "").trim().toLowerCase();
}

function isQbtConfigured() {
  return Boolean(QBT_CONFIG.url && QBT_CONFIG.username && QBT_CONFIG.password);
}

function buildQbtDownloadInfo(torrent) {
  const nowSec = Math.floor(Date.now() / 1000);
  const state = String(torrent.state || "").toLowerCase();
  const isStalled = state.includes("stalled");
  const lastActivity = Number(torrent.last_activity || 0);
  const stalledSeconds = isStalled && lastActivity > 0 ? Math.max(nowSec - lastActivity, 0) : null;
  const eta = Number(torrent.eta || 0);

  return {
    hash: normalizeHash(torrent.hash),
    name: torrent.name || "",
    state: torrent.state || "unknown",
    progressPct: roundTwo(Number(torrent.progress || 0) * 100),
    etaSeconds: eta > 0 ? eta : null,
    isStalled,
    stalledSeconds,
    peers: Number(torrent.num_leechs || 0),
    sizeGb: bytesToGb(Number(torrent.total_size || torrent.size || 0))
  };
}

function aggregateQbtDownloads(items) {
  if (!items.length) return null;
  const downloading = items.filter((item) => !item.isStalled);
  const base = downloading[0] || items[0];
  const etaCandidates = items
    .map((item) => item.etaSeconds)
    .filter((value) => Number.isFinite(value) && value > 0);
  const stalledCandidates = items
    .map((item) => item.stalledSeconds)
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    state: base.state,
    progressPct: roundTwo(items.reduce((sum, item) => sum + item.progressPct, 0) / items.length),
    etaSeconds: etaCandidates.length ? Math.min(...etaCandidates) : null,
    isStalled: items.some((item) => item.isStalled),
    stalledSeconds: stalledCandidates.length ? Math.max(...stalledCandidates) : null,
    peers: items.reduce((sum, item) => sum + item.peers, 0),
    sizeGb: roundTwo(items.reduce((sum, item) => sum + item.sizeGb, 0)),
    torrents: items.length
  };
}

function statusRank(status) {
  const value = String(status || "").toLowerCase();
  if (value === "downloading") return 0;
  if (value === "error") return 1;
  if (value === "wanted") return 2;
  return 3;
}

function extractEpisodeHint(text) {
  const value = String(text || "");
  const single = value.match(/S(\d{1,2})E(\d{1,3})/i);
  if (single) {
    return `S${String(single[1]).padStart(2, "0")}E${String(single[2]).padStart(2, "0")}`;
  }
  const range = value.match(/S(\d{1,2})E(\d{1,3})[- ]?E?(\d{1,3})/i);
  if (range) {
    return `S${String(range[1]).padStart(2, "0")}E${String(range[2]).padStart(2, "0")}-E${String(range[3]).padStart(2, "0")}`;
  }
  return null;
}

async function qbtLogin() {
  if (!QBT_CONFIG.url || !QBT_CONFIG.username || !QBT_CONFIG.password) {
    return "";
  }

  const form = new URLSearchParams();
  form.set("username", QBT_CONFIG.username);
  form.set("password", QBT_CONFIG.password);

  const res = await fetch(`${normalizeUrl(QBT_CONFIG.url)}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`qbittorrent login failed: ${res.status} ${text.slice(0, 80)}`);
  }

  const cookie = res.headers.get("set-cookie") || "";
  return cookie.split(";")[0] || "";
}

async function fetchQbtDownloadsByHash() {
  if (!isQbtConfigured()) {
    return { configured: false, itemsByHash: new Map() };
  }

  const cookie = await qbtLogin();
  const headers = cookie ? { Cookie: cookie } : {};
  const res = await fetch(`${normalizeUrl(QBT_CONFIG.url)}/api/v2/torrents/info`, {
    headers
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`qbittorrent: ${res.status} ${text.slice(0, 100)}`);
  }

  const data = await res.json();
  const map = new Map();
  for (const torrent of Array.isArray(data) ? data : []) {
    const info = buildQbtDownloadInfo(torrent);
    if (!info.hash) continue;
    map.set(info.hash, info);
  }

  return { configured: true, itemsByHash: map };
}

async function fetchQbtStatus() {
  if (!isQbtConfigured()) {
    return { configured: false, status: "not_configured", message: "Not configured" };
  }

  try {
    const cookie = await qbtLogin();
    const headers = cookie ? { Cookie: cookie } : {};
    const [versionRes, transferRes] = await Promise.all([
      fetch(`${normalizeUrl(QBT_CONFIG.url)}/api/v2/app/version`, { headers }),
      fetch(`${normalizeUrl(QBT_CONFIG.url)}/api/v2/transfer/info`, { headers })
    ]);

    if (!versionRes.ok) {
      const text = await versionRes.text();
      throw new Error(`qbittorrent version failed: ${versionRes.status} ${text.slice(0, 80)}`);
    }
    if (!transferRes.ok) {
      const text = await transferRes.text();
      throw new Error(`qbittorrent transfer failed: ${transferRes.status} ${text.slice(0, 80)}`);
    }

    const version = await versionRes.text();
    const transfer = await transferRes.json();
    return {
      configured: true,
      status: "online",
      version: version.trim() || "unknown",
      message: `Connected (${QBT_CONFIG.url})`,
      queueing: Boolean(transfer.queueing)
    };
  } catch (err) {
    return {
      configured: true,
      status: "offline",
      message: `${err.message || "Connection failed"} (${QBT_CONFIG.url})`
    };
  }
}

async function fetchQbtLogs() {
  if (!isQbtConfigured()) return [];

  const cookie = await qbtLogin();
  const headers = cookie ? { Cookie: cookie } : {};
  const res = await fetch(
    `${normalizeUrl(QBT_CONFIG.url)}/api/v2/log/main?normal=true&info=true&warning=true&critical=true&last_known_id=-1`,
    { headers }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`qbittorrent logs failed: ${res.status} ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  const records = Array.isArray(data) ? data : [];
  return records.map((item) => {
    const type = Number(item.type || 1);
    const level = type >= 4 ? "fatal" : type === 2 ? "warn" : "info";
    return {
      service: "qbittorrent",
      level,
      message: item.message || "No message",
      time: item.timestamp ? new Date(item.timestamp * 1000).toISOString() : null
    };
  });
}

function extractRecords(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function queueStateFromRecords(records) {
  const hasError = records.some((rec) => rec?.errorMessage || String(rec?.status || "").toLowerCase() === "failed");
  if (hasError) return "error";
  if (records.length > 0) return "downloading";
  return "idle";
}

function buildSeriesQueueMap(records) {
  const map = new Map();
  for (const rec of records) {
    const seriesId = rec?.seriesId ?? rec?.series?.id;
    if (!seriesId) continue;
    const current = map.get(seriesId) || [];
    current.push(rec);
    map.set(seriesId, current);
  }
  return map;
}

function buildMovieQueueMap(records) {
  const map = new Map();
  for (const rec of records) {
    const movieId = rec?.movieId ?? rec?.movie?.id;
    if (!movieId) continue;
    const current = map.get(movieId) || [];
    current.push(rec);
    map.set(movieId, current);
  }
  return map;
}

async function fetchCategoryItems(service) {
  if (!configuredServices[service]) {
    return [
      {
        id: `not-configured-${service}`,
        service,
        source: "Service",
        title: `${service.toUpperCase()} not configured`,
        summary: "Set URL and API key in Portainer environment variables."
      }
    ];
  }

  const [status, queue] = await Promise.allSettled([
    requestArrWithFallback(service, getStatusEndpoints(service)),
    requestArrWithFallback(service, getQueueEndpoints(service))
  ]);

  const items = [];
  if (status.status === "fulfilled") {
    const st = status.value;
    items.push({
      id: `status-${service}`,
      service,
      source: "System",
      title: `${st.appName || service} v${st.version || "?"}`,
      summary: `Status: ${st.instanceName || "default instance"}`
    });
  }

  if (queue.status === "fulfilled") {
    const records = Array.isArray(queue.value.records) ? queue.value.records : [];
    for (const rec of records.slice(0, 20)) {
      items.push({
        id: rec.id,
        service,
        source: "Queue",
        title: rec.title || rec.series?.title || rec.artist?.artistName || "Queued Item",
        summary:
          rec.status ||
          rec.trackedDownloadState ||
          rec.errorMessage ||
          rec.outputPath ||
          "Queued"
      });
    }
  }

  if (status.status === "rejected" && queue.status === "rejected") {
    items.push({
      id: `unreachable-${service}`,
      service,
      source: "Service",
      title: `${service.toUpperCase()} unreachable`,
      summary: status.reason?.message || queue.reason?.message || "Unable to connect."
    });
  }

  return items;
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, configuredServices: Object.keys(configuredServices) });
});

app.get("/api/services", (_, res) => {
  res.json({
    services: [...ALL_SERVICES, "qbittorrent"],
    configuredServices: [
      ...Object.keys(configuredServices),
      ...(isQbtConfigured() ? ["qbittorrent"] : [])
    ]
  });
});

app.get("/api/overview", async (_, res) => {
  const items = await Promise.all(
    OVERVIEW_SERVICES.map(async (service) => {
      if (service === "qbittorrent") {
        const qbt = await fetchQbtStatus();
        return {
          service,
          configured: qbt.configured,
          status: qbt.status,
          version: qbt.version || undefined,
          appName: "qBittorrent",
          message: qbt.message
        };
      }

      const cfg = configuredServices[service];
      if (!cfg) {
        return {
          service,
          configured: false,
          status: "not_configured",
          message: "Not configured"
        };
      }

      try {
        const status = await requestArrWithFallback(service, getStatusEndpoints(service));
        return {
          service,
          configured: true,
          status: "online",
          version: status.version || "unknown",
          appName: status.appName || service,
          message: `Connected (${cfg.url})`
        };
      } catch (err) {
        return {
          service,
          configured: true,
          status: "offline",
          message: `${err.message || "Connection failed"} (${cfg.url})`
        };
      }
    })
  );

  res.json({ items });
});

app.get("/api/tv/overview", async (_, res) => {
  if (!configuredServices.sonarr) {
    return res.json({ configured: false, wantedDownloading: [], available: [] });
  }

  try {
    const [seriesResult, queueResult, qbtResult] = await Promise.allSettled([
      requestArrWithFallback("sonarr", [`${getPrimaryBase("sonarr")}/series`]),
      requestArrWithFallback("sonarr", getQueueEndpoints("sonarr")),
      fetchQbtDownloadsByHash()
    ]);

    if (seriesResult.status === "rejected") {
      throw seriesResult.reason;
    }

    const series = extractRecords(seriesResult.value);
    const queueRecords = queueResult.status === "fulfilled" ? extractRecords(queueResult.value) : [];
    const queueBySeries = buildSeriesQueueMap(queueRecords);
    const qbtByHash = qbtResult.status === "fulfilled" ? qbtResult.value.itemsByHash : new Map();
    const qbtConfigured = qbtResult.status === "fulfilled" ? qbtResult.value.configured : Boolean(QBT_CONFIG.url);

    const normalizedSeries = series.map((item) => {
      const stats = item.statistics || {};
      const totalEpisodes = Number(stats.episodeCount || stats.totalEpisodeCount || 0);
      const episodeFileCount = Number(stats.episodeFileCount || 0);
      const missingEpisodes = Math.max(totalEpisodes - episodeFileCount, 0);
      const queueRecordsForSeries = queueBySeries.get(item.id) || [];
      const queueState = queueStateFromRecords(queueRecordsForSeries);
      const qbtItems = queueRecordsForSeries
        .map((record) => normalizeHash(record.downloadId || record.trackedDownloadId || ""))
        .map((hash) => qbtByHash.get(hash))
        .filter(Boolean);
      const qbtDownload = aggregateQbtDownloads(qbtItems);
      const downloadItems = queueRecordsForSeries
        .map((record) => {
          const hash = normalizeHash(record.downloadId || record.trackedDownloadId || "");
          const qbt = qbtByHash.get(hash);
          if (!qbt && !hash) return null;
          const sourceTitle =
            qbt?.name ||
            record.title ||
            record.releaseTitle ||
            record.series?.title ||
            "Download";
          return {
            hash,
            name: sourceTitle,
            episodeHint: extractEpisodeHint(sourceTitle),
            state: qbt?.state || record.status || "unknown",
            progressPct: qbt?.progressPct ?? null,
            etaSeconds: qbt?.etaSeconds ?? null,
            isStalled: Boolean(qbt?.isStalled),
            stalledSeconds: qbt?.stalledSeconds ?? null,
            peers: qbt?.peers ?? null,
            sizeGb: qbt?.sizeGb ?? null
          };
        })
        .filter(Boolean);

      let status = "available";
      if (queueState === "error") {
        status = "error";
      } else if (queueState === "downloading") {
        status = "downloading";
      } else if (missingEpisodes > 0) {
        status = "wanted";
      }

      return {
        id: item.id,
        title: item.title || "Unknown series",
        year: extractYear(item.year) || extractYear(item.firstAired),
        posterUrl: pickPosterUrl("sonarr", item),
        status,
        totalEpisodes,
        episodeFileCount,
        missingEpisodes,
        seasons: (item.seasons || [])
          .filter((season) => season.seasonNumber > 0)
          .map((season) => {
            const seasonStats = season.statistics || {};
            const seasonTotal = Number(seasonStats.totalEpisodeCount || seasonStats.episodeCount || 0);
            const seasonFiles = Number(seasonStats.episodeFileCount || 0);
            const seasonStatus =
              seasonTotal > 0 && seasonFiles >= seasonTotal
                ? "available"
                : seasonFiles > 0
                  ? "partially_available"
                  : "wanted";

            return {
              seasonNumber: season.seasonNumber,
              totalEpisodes: seasonTotal,
              episodeFileCount: seasonFiles,
              status: seasonStatus
            };
          }),
        qualityProfileId: item.qualityProfileId || null,
        download: qbtDownload,
        downloadItems
      };
    });

    const wantedDownloading = normalizedSeries
      .filter((item) => item.status !== "available")
      .sort((a, b) => statusRank(a.status) - statusRank(b.status));
    const available = normalizedSeries.filter((item) => item.status === "available");
    return res.json({ configured: true, qbtConfigured, wantedDownloading, available });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to fetch TV overview" });
  }
});

app.get("/api/tv/series/:seriesId/seasons/:seasonNumber/episodes", async (req, res) => {
  if (!configuredServices.sonarr) {
    return res.status(400).json({ error: "Sonarr not configured" });
  }

  const seriesId = Number(req.params.seriesId);
  const seasonNumber = Number(req.params.seasonNumber);
  if (Number.isNaN(seriesId) || Number.isNaN(seasonNumber)) {
    return res.status(400).json({ error: "Invalid series or season number" });
  }

  try {
    const episodesPayload = await requestArrWithFallback("sonarr", [
      `${getPrimaryBase("sonarr")}/episode?seriesId=${seriesId}`
    ]);
    const episodes = extractRecords(episodesPayload)
      .filter((item) => Number(item.seasonNumber) === seasonNumber)
      .sort((a, b) => Number(a.episodeNumber || 0) - Number(b.episodeNumber || 0))
      .map((item) => ({
        id: item.id,
        episodeNumber: item.episodeNumber,
        title: item.title || "Unknown episode",
        hasFile: Boolean(item.hasFile),
        status: item.hasFile ? "available" : "wanted"
      }));

    const totalEpisodes = episodes.length;
    const availableEpisodes = episodes.filter((item) => item.hasFile).length;
    const seasonStatus =
      totalEpisodes > 0 && availableEpisodes === totalEpisodes
        ? "available"
        : availableEpisodes > 0
          ? "partially_available"
          : "wanted";

    return res.json({ items: episodes, totalEpisodes, availableEpisodes, seasonStatus });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to fetch episodes" });
  }
});

app.get("/api/movies/overview", async (_, res) => {
  if (!configuredServices.radarr) {
    return res.json({ configured: false, wantedDownloading: [], available: [] });
  }

  try {
    const [moviesResult, queueResult, qbtResult] = await Promise.allSettled([
      requestArrWithFallback("radarr", [`${getPrimaryBase("radarr")}/movie`]),
      requestArrWithFallback("radarr", getQueueEndpoints("radarr")),
      fetchQbtDownloadsByHash()
    ]);

    if (moviesResult.status === "rejected") {
      throw moviesResult.reason;
    }

    const movies = extractRecords(moviesResult.value);
    const queueRecords = queueResult.status === "fulfilled" ? extractRecords(queueResult.value) : [];
    const queueByMovie = buildMovieQueueMap(queueRecords);
    const qbtByHash = qbtResult.status === "fulfilled" ? qbtResult.value.itemsByHash : new Map();
    const qbtConfigured = qbtResult.status === "fulfilled" ? qbtResult.value.configured : Boolean(QBT_CONFIG.url);

    const normalizedMovies = movies.map((item) => {
      const queueForMovie = queueByMovie.get(item.id) || [];
      const queueState = queueStateFromRecords(queueForMovie);
      const hasFile = Boolean(item.hasFile || item.movieFile);
      const qbtItems = queueForMovie
        .map((record) => normalizeHash(record.downloadId || record.trackedDownloadId || ""))
        .map((hash) => qbtByHash.get(hash))
        .filter(Boolean);
      const qbtDownload = aggregateQbtDownloads(qbtItems);
      const downloadItems = queueForMovie
        .map((record) => {
          const hash = normalizeHash(record.downloadId || record.trackedDownloadId || "");
          const qbt = qbtByHash.get(hash);
          if (!qbt && !hash) return null;
          const sourceTitle = qbt?.name || record.title || record.releaseTitle || item.title || "Download";
          return {
            hash,
            name: sourceTitle,
            state: qbt?.state || record.status || "unknown",
            progressPct: qbt?.progressPct ?? null,
            etaSeconds: qbt?.etaSeconds ?? null,
            isStalled: Boolean(qbt?.isStalled),
            stalledSeconds: qbt?.stalledSeconds ?? null,
            peers: qbt?.peers ?? null,
            sizeGb: qbt?.sizeGb ?? null
          };
        })
        .filter(Boolean);

      let status = "available";
      if (queueState === "error") {
        status = "error";
      } else if (queueState === "downloading") {
        status = "downloading";
      } else if (!hasFile) {
        status = "wanted";
      }

      return {
        id: item.id,
        title: item.title || "Unknown movie",
        year: extractYear(item.year) || extractYear(item.inCinemas) || extractYear(item.digitalRelease),
        posterUrl: pickPosterUrl("radarr", item),
        status,
        download: qbtDownload,
        downloadItems
      };
    });

    const wantedDownloading = normalizedMovies
      .filter((item) => item.status !== "available")
      .sort((a, b) => statusRank(a.status) - statusRank(b.status));
    const available = normalizedMovies.filter((item) => item.status === "available");
    return res.json({ configured: true, qbtConfigured, wantedDownloading, available });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to fetch movies overview" });
  }
});

app.get("/api/dashboard/:category", async (req, res) => {
  const services = CATEGORY_TO_SERVICES[req.params.category];
  if (!services) {
    return res.status(400).json({ error: "Unknown category" });
  }

  try {
    const data = await Promise.all(services.map((service) => fetchCategoryItems(service)));
    return res.json({ items: data.flat() });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get("/api/errors", async (req, res) => {
  const requestedService = (req.query.service || "all").toString().toLowerCase();
  const requestedLevel = (req.query.level || "all").toString().toLowerCase();
  const search = (req.query.search || "").toString().toLowerCase();

  const baseTargets = Object.keys(configuredServices);
  const qbtEnabled = isQbtConfigured();
  const allTargets = qbtEnabled ? [...baseTargets, "qbittorrent"] : baseTargets;
  const targets =
    requestedService === "all" ? allTargets : allTargets.filter((s) => s === requestedService);

  if (targets.length === 0) {
    return res.json({ items: [] });
  }

  const logsByService = await Promise.allSettled(
    targets.map(async (service) => {
      if (service === "qbittorrent") {
        return fetchQbtLogs();
      }
      const logs = await requestArrWithFallback(service, getLogEndpoints(service));
      const records = Array.isArray(logs.records)
        ? logs.records
        : Array.isArray(logs.data)
          ? logs.data
          : [];
      return records.map((entry) => normalizeLogEntry(service, entry));
    })
  );

  let items = logsByService
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  if (requestedLevel !== "all") {
    items = items.filter((item) => item.level === requestedLevel);
  }

  if (search) {
    items = items.filter((item) => item.message.toLowerCase().includes(search));
  }

  return res.json({ items: items.slice(0, 400) });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distDir));
  app.get("*", (_, res) => res.sendFile(path.join(distDir, "index.html")));
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[hydrarr] server listening on ${port}`);
  console.log(`[hydrarr] configured services: ${Object.keys(configuredServices).join(", ") || "none"}`);
});
