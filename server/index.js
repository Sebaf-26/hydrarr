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
const SERVICE_API_BASE = {
  sonarr: "/api/v3",
  radarr: "/api/v3",
  lidarr: "/api/v1",
  readarr: "/api/v1",
  prowlarr: "/api/v1",
  bazarr: "/api"
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
    services: ALL_SERVICES,
    configuredServices: Object.keys(configuredServices)
  });
});

app.get("/api/overview", async (_, res) => {
  const items = await Promise.all(
    ALL_SERVICES.map(async (service) => {
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
    const [seriesPayload, queuePayload] = await Promise.all([
      requestArrWithFallback("sonarr", [`${getPrimaryBase("sonarr")}/series`]),
      requestArrWithFallback("sonarr", getQueueEndpoints("sonarr"))
    ]);

    const series = extractRecords(seriesPayload);
    const queueRecords = extractRecords(queuePayload);
    const queueBySeries = buildSeriesQueueMap(queueRecords);

    const normalizedSeries = series.map((item) => {
      const stats = item.statistics || {};
      const totalEpisodes = Number(stats.episodeCount || stats.totalEpisodeCount || 0);
      const episodeFileCount = Number(stats.episodeFileCount || 0);
      const missingEpisodes = Math.max(totalEpisodes - episodeFileCount, 0);
      const queueRecordsForSeries = queueBySeries.get(item.id) || [];
      const queueState = queueStateFromRecords(queueRecordsForSeries);

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
        status,
        totalEpisodes,
        episodeFileCount,
        missingEpisodes,
        seasons: (item.seasons || []).filter((season) => season.seasonNumber > 0),
        qualityProfileId: item.qualityProfileId || null
      };
    });

    const wantedDownloading = normalizedSeries.filter((item) => item.status !== "available");
    const available = normalizedSeries.filter((item) => item.status === "available");
    return res.json({ configured: true, wantedDownloading, available });
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

    return res.json({ items: episodes });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Failed to fetch episodes" });
  }
});

app.get("/api/movies/overview", async (_, res) => {
  if (!configuredServices.radarr) {
    return res.json({ configured: false, wantedDownloading: [], available: [] });
  }

  try {
    const [moviesPayload, queuePayload] = await Promise.all([
      requestArrWithFallback("radarr", [`${getPrimaryBase("radarr")}/movie`]),
      requestArrWithFallback("radarr", getQueueEndpoints("radarr"))
    ]);

    const movies = extractRecords(moviesPayload);
    const queueRecords = extractRecords(queuePayload);
    const queueByMovie = buildMovieQueueMap(queueRecords);

    const normalizedMovies = movies.map((item) => {
      const queueForMovie = queueByMovie.get(item.id) || [];
      const queueState = queueStateFromRecords(queueForMovie);

      let status = "available";
      if (queueState === "error") {
        status = "error";
      } else if (queueState === "downloading") {
        status = "downloading";
      } else if (!item.hasFile) {
        status = "wanted";
      }

      return {
        id: item.id,
        title: item.title || "Unknown movie",
        status,
        summary: item.hasFile ? "Present in library" : "Missing from library"
      };
    });

    const wantedDownloading = normalizedMovies.filter((item) => item.status !== "available");
    const available = normalizedMovies.filter((item) => item.status === "available");
    return res.json({ configured: true, wantedDownloading, available });
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

  const targets =
    requestedService === "all"
      ? Object.keys(configuredServices)
      : Object.keys(configuredServices).filter((s) => s === requestedService);

  if (targets.length === 0) {
    return res.json({ items: [] });
  }

  const logsByService = await Promise.allSettled(
    targets.map(async (service) => {
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
