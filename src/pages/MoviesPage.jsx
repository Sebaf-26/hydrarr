import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

function StatusPill({ status }) {
  return <span className={`media-state media-state-${status}`}>{status}</span>;
}

function ProgressRing({ value }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)));
  const deg = pct * 3.6;
  return (
    <div className="progress-ring" style={{ "--p": `${deg}deg` }}>
      <div className="progress-ring-inner">{pct.toFixed(1)}%</div>
    </div>
  );
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

function MovieCard({ movie }) {
  return (
    <article className="card media-card" key={movie.id}>
      <div className="row media-top-row">
        <StatusPill status={movie.status} />
      </div>
      <h3>{movie.title}</h3>
      {movie.download && (
        <div className="download-stats-wrap">
          <ProgressRing value={movie.download.progressPct} />
          <div className="download-stats">
            <span>ETA: {formatEta(movie.download.etaSeconds)}</span>
            <span>Peers: {movie.download.peers}</span>
            <span>GB: {movie.download.sizeGb}</span>
            <span>Stalled: {movie.download.isStalled ? "Yes" : "No"}</span>
            {movie.download.isStalled && <span>Stalled For: {formatDuration(movie.download.stalledSeconds)}</span>}
          </div>
        </div>
      )}
      {Array.isArray(movie.downloadItems) && movie.downloadItems.length > 0 && (
        <div className="download-list">
          {movie.downloadItems.map((item, idx) => (
            <article className="download-item" key={`${item.hash || item.name}-${idx}`}>
              <div className="download-item-head">
                <strong>{item.name}</strong>
                {typeof item.progressPct === "number" && <span>{item.progressPct.toFixed(1)}%</span>}
              </div>
              <div className="download-item-meta">
                <span>ETA: {formatEta(item.etaSeconds)}</span>
                <span>Peers: {item.peers ?? "-"}</span>
                <span>GB: {item.sizeGb ?? "-"}</span>
                <span>Stalled: {item.isStalled ? "Yes" : "No"}</span>
                {item.isStalled && <span>Stalled For: {formatDuration(item.stalledSeconds)}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}

function AvailableMovieCard({ movie }) {
  return (
    <article className="available-card" key={movie.id}>
      <div className="available-poster-wrap">
        {movie.posterUrl ? (
          <img className="available-poster" src={movie.posterUrl} alt={movie.title} loading="lazy" />
        ) : (
          <div className="available-poster-fallback">No Poster</div>
        )}
      </div>
      <div className="available-meta">
        <h4>{movie.title}</h4>
        <p className="muted">{movie.year || "-"}</p>
      </div>
    </article>
  );
}

export default function MoviesPage() {
  const [state, setState] = useState({ loading: true, error: "", wanted: [], available: [] });

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "", wanted: [], available: [] });

    apiFetch("/api/movies/overview")
      .then((json) => {
        if (!active) return;
        if (!json.configured) {
          setState({
            loading: false,
            error: "Radarr is not configured. Add RADARR_URL and RADARR_API_KEY in Portainer Env.",
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

  return (
    <section>
      <header className="page-header">
        <h2>Movies</h2>
      </header>

      {state.loading && <p>Loading movies data...</p>}
      {state.error && <p className="error">{state.error}</p>}

      {!state.loading && !state.error && (
        <>
          <h3 className="section-title">Wanted/Downloading</h3>
          <div className="two-col-grid">{state.wanted.map((movie) => <MovieCard key={movie.id} movie={movie} />)}</div>
          {state.wanted.length === 0 && <p className="muted">No wanted or downloading movies.</p>}

          <h3 className="section-title">Available</h3>
          <div className="available-strip">
            {state.available.map((movie) => (
              <AvailableMovieCard key={movie.id} movie={movie} />
            ))}
          </div>
          {state.available.length === 0 && <p className="muted">No available movies found.</p>}
        </>
      )}
    </section>
  );
}
