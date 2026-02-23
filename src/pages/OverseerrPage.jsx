import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function itemTitle(item) {
  return item.title || item.name || "Unknown";
}

function itemYear(item) {
  const value = item.releaseDate || item.firstAirDate || "";
  return value && value.length >= 4 ? value.slice(0, 4) : "";
}

function requestStatusLabel(req) {
  const status = req?.status;
  if (typeof status === "number") {
    if (status === 1) return "pending";
    if (status === 2) return "approved";
    if (status === 3) return "declined";
    return `status ${status}`;
  }
  return String(status || "unknown");
}

export default function OverseerrPage() {
  const [cfg, setCfg] = useState({ loading: true, error: "", configured: false, url: "" });
  const [requests, setRequests] = useState({ loading: true, error: "", items: [] });
  const [searchText, setSearchText] = useState("");
  const [searchState, setSearchState] = useState({ loading: false, error: "", items: [] });
  const [actionMsg, setActionMsg] = useState("");

  async function loadRequests() {
    setRequests((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const res = await fetch("/api/overseerr/api/v1/request?take=50&skip=0&sort=added");
      const json = await readJsonSafe(res);
      if (!res.ok) throw new Error(json.error || "Failed to load requests");
      const items = Array.isArray(json.results) ? json.results : Array.isArray(json.requests) ? json.requests : [];
      setRequests({ loading: false, error: "", items });
    } catch (err) {
      setRequests({ loading: false, error: err.message, items: [] });
    }
  }

  useEffect(() => {
    let active = true;
    setCfg({ loading: true, error: "", configured: false, url: "" });
    apiFetch("/api/integrations/overseerr")
      .then((json) => {
        if (!active) return;
        setCfg({
          loading: false,
          error: "",
          configured: Boolean(json.configured),
          url: json.url || ""
        });
      })
      .catch((err) => {
        if (!active) return;
        setCfg({ loading: false, error: err.message, configured: false, url: "" });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!cfg.configured) return;
    loadRequests();
  }, [cfg.configured]);

  async function runSearch() {
    if (!searchText.trim()) {
      setSearchState({ loading: false, error: "", items: [] });
      return;
    }
    setSearchState({ loading: true, error: "", items: [] });
    try {
      const res = await fetch(`/api/overseerr/api/v1/search?query=${encodeURIComponent(searchText.trim())}`);
      const json = await readJsonSafe(res);
      if (!res.ok) throw new Error(json.error || "Search failed");
      const items = Array.isArray(json.results) ? json.results : [];
      setSearchState({ loading: false, error: "", items });
    } catch (err) {
      setSearchState({ loading: false, error: err.message, items: [] });
    }
  }

  async function createRequest(item) {
    setActionMsg("Creating request...");
    const payload = {
      mediaType: item.mediaType,
      mediaId: item.id
    };
    const res = await fetch("/api/overseerr/api/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setActionMsg(json.error || "Create request failed");
      return;
    }
    setActionMsg(`Request created for ${itemTitle(item)}`);
    loadRequests();
  }

  async function setRequestDecision(id, type) {
    setActionMsg(`${type} request #${id}...`);
    const res = await fetch(`/api/overseerr/api/v1/request/${id}/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setActionMsg(json.error || `Failed to ${type} request`);
      return;
    }
    setActionMsg(`Request #${id} ${type}d`);
    loadRequests();
  }

  return (
    <section>
      <header className="page-header">
        <h2>Overseerr</h2>
      </header>

      {cfg.loading && <p>Checking Overseerr integration...</p>}
      {cfg.error && <p className="error">{cfg.error}</p>}
      {!cfg.loading && !cfg.error && !cfg.configured && (
        <p className="error">Set OVERSEERR_URL and OVERSEERR_API_KEY in env to enable this section.</p>
      )}

      {!cfg.loading && !cfg.error && cfg.configured && (
        <>
          <div className="row">
            <a className="action-btn" href={cfg.url} target="_blank" rel="noreferrer">
              Open Overseerr
            </a>
          </div>

          <h3 className="section-title">Search</h3>
          <div className="card">
            <div className="row">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search movie or TV title..."
              />
              <button type="button" className="action-btn action-btn-inline" onClick={runSearch}>
                Search
              </button>
            </div>
            {searchState.loading && <p className="muted">Searching...</p>}
            {searchState.error && <p className="error">{searchState.error}</p>}
            <div className="overseerr-search-grid">
              {searchState.items.map((item) => (
                <article className="overseerr-media-card" key={`${item.mediaType}-${item.id}`}>
                  {item.posterPath ? (
                    <img
                      className="overseerr-poster"
                      src={`/api/overseerr/api/v1/image/tmdb/w300${item.posterPath}`}
                      alt={itemTitle(item)}
                      loading="lazy"
                    />
                  ) : (
                    <div className="overseerr-poster overseerr-poster-fallback">No Poster</div>
                  )}
                  <div className="overseerr-media-meta">
                    <strong>{itemTitle(item)}</strong>
                    <span className="muted">
                      {item.mediaType || "-"} {itemYear(item) ? `• ${itemYear(item)}` : ""}
                    </span>
                    <button type="button" className="action-btn action-btn-inline" onClick={() => createRequest(item)}>
                      Request
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <h3 className="section-title">Requests</h3>
          <div className="card">
            <div className="row">
              <button type="button" className="action-btn action-btn-inline" onClick={loadRequests}>
                Refresh
              </button>
              {actionMsg && <span className="muted">{actionMsg}</span>}
            </div>
            {requests.loading && <p className="muted">Loading requests...</p>}
            {requests.error && <p className="error">{requests.error}</p>}
            <div className="overseerr-requests-list">
              {requests.items.map((req) => (
                <article className="overseerr-request-item" key={req.id}>
                  <div>
                    <strong>{itemTitle(req.media || req)}</strong>
                    <p className="muted">
                      {req.media?.mediaType || req.type || "-"} • {requestStatusLabel(req)}
                    </p>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="action-btn action-btn-inline"
                      onClick={() => setRequestDecision(req.id, "approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="action-btn action-btn-inline"
                      onClick={() => setRequestDecision(req.id, "decline")}
                    >
                      Decline
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
