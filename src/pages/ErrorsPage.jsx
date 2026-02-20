import { useEffect, useMemo, useState } from "react";
import { apiFetch, toTitle } from "../lib";
import ServiceBadge from "../components/ServiceBadge";

export default function ErrorsPage() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState("all");
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: true, error: "", items: [] });
  const [toolService, setToolService] = useState("radarr");
  const [toolQuery, setToolQuery] = useState("");
  const [toolItems, setToolItems] = useState([]);
  const [toolItemId, setToolItemId] = useState("");
  const [toolLoadingItems, setToolLoadingItems] = useState(false);
  const [releaseState, setReleaseState] = useState({ loading: false, error: "", items: [] });
  const [grabState, setGrabState] = useState({ loading: false, message: "", error: "" });

  useEffect(() => {
    apiFetch("/api/services")
      .then((json) => setServices(json.services || []))
      .catch(() => setServices([]));
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (selectedService !== "all") params.set("service", selectedService);
    if (selectedLevel !== "all") params.set("level", selectedLevel);
    if (search.trim()) params.set("search", search.trim());

    setState({ loading: true, error: "", items: [] });
    apiFetch(`/api/errors?${params.toString()}`)
      .then((json) => {
        if (active) setState({ loading: false, error: "", items: json.items || [] });
      })
      .catch((err) => {
        if (active) setState({ loading: false, error: err.message, items: [] });
      });

    return () => {
      active = false;
    };
  }, [selectedService, selectedLevel, search]);

  useEffect(() => {
    let active = true;
    setToolLoadingItems(true);
    apiFetch(`/api/library/items?service=${toolService}&q=${encodeURIComponent(toolQuery)}`)
      .then((json) => {
        if (!active) return;
        const items = json.items || [];
        setToolItems(items);
        if (!items.some((item) => String(item.id) === String(toolItemId))) {
          setToolItemId(items[0]?.id ? String(items[0].id) : "");
        }
      })
      .catch(() => {
        if (!active) return;
        setToolItems([]);
        setToolItemId("");
      })
      .finally(() => {
        if (active) setToolLoadingItems(false);
      });
    return () => {
      active = false;
    };
  }, [toolService, toolQuery]);

  const levels = useMemo(() => ["all", "fatal", "error", "warn", "info"], []);

  async function runInteractiveSearch() {
    if (!toolItemId) return;
    setReleaseState({ loading: true, error: "", items: [] });
    setGrabState({ loading: false, message: "", error: "" });
    try {
      const json = await apiFetch(`/api/releases?service=${toolService}&itemId=${toolItemId}`);
      setReleaseState({ loading: false, error: "", items: json.items || [] });
    } catch (err) {
      setReleaseState({ loading: false, error: err.message, items: [] });
    }
  }

  async function grabRelease(release) {
    setGrabState({ loading: true, message: "", error: "" });
    try {
      const res = await fetch("/api/releases/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: toolService,
          release: release.full
        })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Grab failed");
      }
      setGrabState({ loading: false, message: "Release sent to download client.", error: "" });
    } catch (err) {
      setGrabState({ loading: false, message: "", error: err.message });
    }
  }

  return (
    <section>
      <header className="page-header">
        <h2>Debugging</h2>
      </header>

      <div className="interactive-box">
        <h3 className="section-title">Interactive Releases</h3>
        <div className="filters">
          <label>
            Service
            <select value={toolService} onChange={(e) => setToolService(e.target.value)}>
              <option value="radarr">Radarr (Movies)</option>
              <option value="sonarr">Sonarr (TV)</option>
            </select>
          </label>

          <label>
            Search title
            <input
              type="text"
              value={toolQuery}
              placeholder="Type movie/series title..."
              onChange={(e) => setToolQuery(e.target.value)}
            />
          </label>

          <label>
            Item
            <select value={toolItemId} onChange={(e) => setToolItemId(e.target.value)}>
              {toolItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} {item.year ? `(${item.year})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          className="action-btn"
          onClick={runInteractiveSearch}
          disabled={!toolItemId || toolLoadingItems || releaseState.loading}
        >
          {releaseState.loading ? "Loading releases..." : "Load releases"}
        </button>

        {grabState.message && <p className="muted">{grabState.message}</p>}
        {grabState.error && <p className="error">{grabState.error}</p>}
        {releaseState.error && <p className="error">{releaseState.error}</p>}

        {releaseState.items.length > 0 && (
          <div className="release-list">
            {releaseState.items.map((release, idx) => (
              <article className="release-item" key={`${release.guid || release.title}-${idx}`}>
                <div className="release-main">
                  <h4>{release.title}</h4>
                  <p className="muted">
                    {release.indexer} | {release.sizeGb ? `${release.sizeGb} GB` : "-"} | Peers{" "}
                    {release.seeders ?? "-"} / {release.leechers ?? "-"} | {release.language || "-"} |{" "}
                    {release.quality || "-"}
                  </p>
                </div>
                <div className="release-side">
                  <span className={release.rejected ? "rel-state rel-rejected" : "rel-state rel-ok"}>
                    {release.rejected ? "Rejected" : "Accepted"}
                  </span>
                  <button type="button" className="action-btn" onClick={() => grabRelease(release)}>
                    Grab
                  </button>
                </div>
                {release.rejections?.length > 0 && (
                  <ul className="release-reasons">
                    {release.rejections.map((reason, ridx) => (
                      <li key={`${release.title}-${ridx}`}>{reason}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="filters">
        <label>
          Service
          <select value={selectedService} onChange={(e) => setSelectedService(e.target.value)}>
            <option value="all">All</option>
            {services.map((service) => (
              <option key={service} value={service}>
                {service.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label>
          Level
          <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}>
            {levels.map((level) => (
              <option key={level} value={level}>
                {toTitle(level)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Search
          <input
            type="text"
            value={search}
            placeholder="Filter message..."
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {state.loading && <p>Loading logs...</p>}
      {state.error && <p className="error">{state.error}</p>}

      <div className="log-list">
        {state.items.map((item, idx) => (
          <article key={`${item.service}-${item.time}-${idx}`} className="log-item">
            <div className="row">
              <ServiceBadge name={item.service} />
              <span className={`level level-${item.level}`}>{item.level.toUpperCase()}</span>
              <time className="muted">{item.time || "Unknown time"}</time>
            </div>
            <p>{item.message || "No message"}</p>
          </article>
        ))}
      </div>

      {!state.loading && !state.error && state.items.length === 0 && <p>No matching logs.</p>}
    </section>
  );
}
