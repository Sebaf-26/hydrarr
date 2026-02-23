import { useEffect, useState } from "react";
import { apiFetch } from "../lib";
import ServiceBadge from "../components/ServiceBadge";

export default function MusicPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [overview, setOverview] = useState({ loading: true, error: "", data: [] });
  const [plex, setPlex] = useState({ loading: true, error: "", configured: false, url: "" });

  useEffect(() => {
    let active = true;
    setOverview({ loading: true, error: "", data: [] });

    apiFetch("/api/dashboard/music")
      .then((json) => {
        if (active) setOverview({ loading: false, error: "", data: json.items || [] });
      })
      .catch((err) => {
        if (active) setOverview({ loading: false, error: err.message, data: [] });
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPlex({ loading: true, error: "", configured: false, url: "" });

    apiFetch("/api/integrations/plex-playlist-reorder")
      .then((json) => {
        if (!active) return;
        setPlex({
          loading: false,
          error: "",
          configured: Boolean(json.configured),
          url: json.url || ""
        });
      })
      .catch((err) => {
        if (!active) return;
        setPlex({ loading: false, error: err.message, configured: false, url: "" });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <header className="page-header">
        <h2>Music</h2>
      </header>

      <div className="music-submenu">
        <button
          type="button"
          className={activeTab === "overview" ? "music-submenu-btn music-submenu-btn-active" : "music-submenu-btn"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={activeTab === "plex-reorder" ? "music-submenu-btn music-submenu-btn-active" : "music-submenu-btn"}
          onClick={() => setActiveTab("plex-reorder")}
        >
          Plex Playlist Reorderer
        </button>
      </div>

      {activeTab === "overview" && (
        <>
          {overview.loading && <p>Loading music data...</p>}
          {overview.error && <p className="error">{overview.error}</p>}

          <div className="grid">
            {overview.data.map((item) => (
              <article className="card" key={`${item.service}-${item.id}`}>
                <div className="row">
                  <ServiceBadge name={item.service} />
                  <span className="muted">{item.source}</span>
                </div>
                <h3>{item.title || "Unknown"}</h3>
                <p className="muted">{item.summary || "No details available."}</p>
              </article>
            ))}
          </div>

          {!overview.loading && !overview.error && overview.data.length === 0 && (
            <p>No configured services returned data for this section.</p>
          )}
        </>
      )}

      {activeTab === "plex-reorder" && (
        <div className="music-integration-wrap">
          {plex.loading && <p>Loading Plex Playlist Reorderer integration...</p>}
          {plex.error && <p className="error">{plex.error}</p>}
          {!plex.loading && !plex.error && !plex.configured && (
            <article className="card">
              <h3>Plex Playlist Reorderer not configured</h3>
              <p className="muted">
                Set <code>PLEX_URL</code> in Hydrarr environment to embed the tool here.
              </p>
            </article>
          )}
          {!plex.loading && !plex.error && plex.configured && (
            <div className="music-plex-panel">
              <div className="music-plex-head">
                <a className="action-btn" href={plex.url} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              </div>
              <iframe
                className="music-plex-frame"
                src={plex.url}
                title="Plex Playlist Reorderer"
                loading="lazy"
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
