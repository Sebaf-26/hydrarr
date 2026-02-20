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

  return res.json();
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

async function fetchCategoryItems(service) {
  const [status, queue] = await Promise.allSettled([
    requestArr(service, "/api/v1/system/status"),
    requestArr(service, "/api/v1/queue?page=1&pageSize=50&sortKey=timeleft&sortDirection=ascending")
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

  return items;
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, configuredServices: Object.keys(configuredServices) });
});

app.get("/api/services", (_, res) => {
  res.json({ services: Object.keys(configuredServices) });
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
      const logs = await requestArr(service, "/api/v1/log?sortKey=time&sortDirection=descending&page=1&pageSize=250");
      const records = Array.isArray(logs.records) ? logs.records : [];
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
