import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

function StatusPill({ status }) {
  return <span className={`media-state media-state-${status}`}>{status}</span>;
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function AvailableSeriesCard({ series }) {
  return (
    <article className="available-card" key={series.id}>
      <div className="available-poster-wrap">
        {series.posterUrl ? (
          <img className="available-poster" src={series.posterUrl} alt={series.title} loading="lazy" />
        ) : (
          <div className="available-poster-fallback">No Poster</div>
        )}
      </div>
      <div className="available-meta">
        <h4>{series.title}</h4>
        <p className="muted">{series.year || "-"}</p>
      </div>
    </article>
  );
}

export default function TvPage() {
  const [state, setState] = useState({ loading: true, error: "", wanted: [], available: [] });
  const [openSeries, setOpenSeries] = useState({});
  const [seasonState, setSeasonState] = useState({});

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "", wanted: [], available: [] });

    apiFetch("/api/tv/overview")
      .then((json) => {
        if (!active) return;
        if (!json.configured) {
          setState({
            loading: false,
            error: "Sonarr is not configured. Add SONARR_URL and SONARR_API_KEY in Portainer Env.",
            wanted: [],
            available: []
          });
          return;
        }
        setState({
          loading: false,
          error: "",
          wanted: json.wantedDownloading || [],
          available: json.available || []
        });
      })
      .catch((err) => {
        if (active) setState({ loading: false, error: err.message, wanted: [], available: [] });
      });

    return () => {
      active = false;
    };
  }, []);

  function toggleSeries(seriesId) {
    setOpenSeries((prev) => ({ ...prev, [seriesId]: !prev[seriesId] }));
  }

  function toggleSeason(seriesId, seasonNumber) {
    const key = `${seriesId}-${seasonNumber}`;
    const current = seasonState[key];
    if (current) {
      setSeasonState((prev) => ({ ...prev, [key]: { ...current, open: !current.open } }));
      return;
    }

    setSeasonState((prev) => ({
      ...prev,
      [key]: { loading: true, error: "", open: true, episodes: [] }
    }));

    apiFetch(`/api/tv/series/${seriesId}/seasons/${seasonNumber}/episodes`)
      .then((json) => {
        setSeasonState((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            error: "",
            open: true,
            episodes: json.items || [],
            seasonStatus: json.seasonStatus || "wanted"
          }
        }));
      })
      .catch((err) => {
        setSeasonState((prev) => ({
          ...prev,
          [key]: { loading: false, error: err.message, open: true, episodes: [] }
        }));
      });
  }

  function renderSeriesCard(series) {
    return (
      <article className="card media-card" key={series.id}>
        <div className="row media-top-row">
          <StatusPill status={series.status} />
          <span className="episodes-pill">
            {series.episodeFileCount}/{series.totalEpisodes}
          </span>
        </div>

        <h3>{series.title}</h3>
        {series.missingEpisodes > 0 && <p className="muted">Missing: {series.missingEpisodes}</p>}
        {series.download && (
          <div className="download-stats">
            <span>Progress: {series.download.progressPct}%</span>
            <span>ETA: {formatEta(series.download.etaSeconds)}</span>
            <span>Stalled: {series.download.isStalled ? "Yes" : "No"}</span>
            <span>Stalled For: {series.download.isStalled ? formatDuration(series.download.stalledSeconds) : "-"}</span>
            <span>Peers: {series.download.peers}</span>
            <span>GB: {series.download.sizeGb}</span>
          </div>
        )}

        <button type="button" className="action-btn" onClick={() => toggleSeries(series.id)}>
          {openSeries[series.id] ? "Hide seasons" : "Open seasons"}
        </button>

        {openSeries[series.id] && (
          <div className="expand-area">
            {(series.seasons || []).map((season) => {
              const seasonKey = `${series.id}-${season.seasonNumber}`;
              const seasonInfo = seasonState[seasonKey];
              const seasonStatus = season.status || "wanted";
              return (
                <div key={seasonKey} className="expand-line">
                  <button
                    type="button"
                    className="expand-btn"
                    onClick={() => toggleSeason(series.id, season.seasonNumber)}
                  >
                    <span>Season {season.seasonNumber}</span>
                    <span className={`season-state season-state-${seasonStatus}`}>
                      {seasonStatus.replace("_", " ")}
                    </span>
                  </button>

                  {seasonInfo?.open && (
                    <div className="episodes-list">
                      {seasonInfo.loading && <p className="muted">Loading episodes...</p>}
                      {seasonInfo.error && <p className="error">{seasonInfo.error}</p>}
                      {!seasonInfo.loading && !seasonInfo.error && seasonStatus === "partially_available" && (
                        <ul>
                          {seasonInfo.episodes.map((ep) => (
                            <li key={ep.id} className="episode-item">
                              <span className={ep.hasFile ? "ep-ok" : "ep-miss"}>
                                {ep.hasFile ? "✓" : "X"}
                              </span>
                              <span>
                                E{String(ep.episodeNumber).padStart(2, "0")} - {ep.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!seasonInfo.loading && !seasonInfo.error && seasonStatus !== "partially_available" && (
                        <p className="muted">
                          {seasonStatus === "available"
                            ? "All episodes available."
                            : "No episodes currently available."}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </article>
    );
  }

  return (
    <section>
      <header className="page-header">
        <h2>TV Series</h2>
      </header>

      {state.loading && <p>Loading TV data...</p>}
      {state.error && <p className="error">{state.error}</p>}

      {!state.loading && !state.error && (
        <>
          <h3 className="section-title">Wanted/Downloading</h3>
          <div className="two-col-grid">{state.wanted.map(renderSeriesCard)}</div>
          {state.wanted.length === 0 && <p className="muted">No wanted or downloading series.</p>}

          <h3 className="section-title">Available</h3>
          <div className="available-strip">
            {state.available.map((series) => (
              <AvailableSeriesCard key={series.id} series={series} />
            ))}
          </div>
          {state.available.length === 0 && <p className="muted">No fully available series found.</p>}
        </>
      )}
    </section>
  );
}
