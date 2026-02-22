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
  const [releaseState, setReleaseState] = useState({});

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

  function toggleInteractive(itemId) {
    const key = `radarr-${itemId}`;
    const current = releaseState[key];
    if (current?.loaded) {
      setReleaseState((prev) => ({ ...prev, [key]: { ...current, open: !current.open } }));
      return;
    }

    setReleaseState((prev) => ({
      ...prev,
      [key]: { loading: true, loaded: false, open: true, error: "", items: [] }
    }));

    apiFetch(`/api/releases?service=radarr&itemId=${itemId}`)
      .then((json) => {
        const rejected = (json.items || []).filter((entry) => entry.rejected);
        setReleaseState((prev) => ({
          ...prev,
          [key]: { loading: false, loaded: true, open: true, error: "", items: rejected }
        }));
      })
      .catch((err) => {
        setReleaseState((prev) => ({
          ...prev,
          [key]: { loading: false, loaded: true, open: true, error: err.message, items: [] }
        }));
      });
  }

  async function grabRelease(release, key) {
    const selectedId = release.guid || release.downloadUrl || release.title;
    setReleaseState((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        grabbing: true,
        grabbingReleaseId: selectedId,
        grabError: "",
        grabMessage: ""
      }
    }));
    try {
      const res = await fetch("/api/releases/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: "radarr", release: release.full })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Grab failed");
      setReleaseState((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          grabbing: false,
          grabbingReleaseId: selectedId,
          grabError: "",
          grabMessage: "Release sent to download client. Refreshing..."
        }
      }));
      setTimeout(() => {
        window.location.reload();
      }, 1600);
    } catch (err) {
      setReleaseState((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          grabbing: false,
          grabbingReleaseId: null,
          grabError: err.message,
          grabMessage: ""
        }
      }));
    }
  }

  function metaValue(value, fallback = "-") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  }

  function renderWantedMovie(movie) {
    const key = `radarr-${movie.id}`;
    const rel = releaseState[key];
    const canShowInteractive = movie.status === "wanted";
    const filteredReleases = Array.isArray(rel?.items)
      ? rel.items.filter((release) => {
          if (!rel?.grabbingReleaseId) return true;
          const releaseId = release.guid || release.downloadUrl || release.title;
          return releaseId === rel.grabbingReleaseId;
        })
      : [];
    return (
      <article className="card media-card" key={movie.id}>
        <div className="row media-top-row">
          <StatusPill status={movie.status} />
        </div>
        <div className="title-row">
          <h3>{movie.title}</h3>
          {canShowInteractive && (
            <button type="button" className="action-btn action-btn-inline" onClick={() => toggleInteractive(movie.id)}>
              {rel?.open ? "Hide Interactive Search" : "Interactive Search"}
            </button>
          )}
        </div>
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
        {canShowInteractive && (
          <>
            {rel?.open && (
              <div className="release-list">
                {rel.loading && <p className="muted">Loading rejected releases...</p>}
                {rel.error && <p className="error">{rel.error}</p>}
                {rel.grabMessage && <p className="grab-success-banner">{rel.grabMessage}</p>}
                {rel.grabError && <p className="error">{rel.grabError}</p>}
                {!rel.loading && !rel.error && rel.loaded && rel.items.length === 0 && (
                  <p className="muted">No rejected releases found.</p>
                )}
                {!rel.loading &&
                  filteredReleases.map((release, idx) => (
                    <article className="release-item" key={`${release.guid || release.title}-${idx}`}>
                      <div className="release-main">
                        <h4>{release.title}</h4>
                        <div className="release-meta-grid">
                          <div className="release-meta-row">
                            <span className="release-meta-label">Indexer</span>
                            <span className="release-meta-pill">{metaValue(release.indexer)}</span>
                          </div>
                          <div className="release-meta-row">
                            <span className="release-meta-label">Size</span>
                            <span className="release-meta-pill">
                              {release.sizeGb ? `${release.sizeGb} GB` : "-"}
                            </span>
                          </div>
                          <div className="release-meta-row">
                            <span className="release-meta-label">Peers</span>
                            <span className="release-meta-pill">
                              {metaValue(release.seeders)} / {metaValue(release.leechers)}
                            </span>
                          </div>
                          <div className="release-meta-row">
                            <span className="release-meta-label">Language</span>
                            <span className="release-meta-pill">{metaValue(release.language)}</span>
                          </div>
                          <div className="release-meta-row">
                            <span className="release-meta-label">Quality</span>
                            <span className="release-meta-pill">{metaValue(release.quality)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="release-side">
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => grabRelease(release, key)}
                          disabled={Boolean(rel.grabbing)}
                        >
                          {rel.grabbing ? "Grabbing..." : "Grab"}
                        </button>
                      </div>
                      {release.rejections?.length > 0 && (
                        <div className="release-reason-box">
                          <p><strong>Why rejected:</strong> {release.rejections[0]}</p>
                          {release.rejections.length > 1 && (
                            <ul className="release-reasons">
                              {release.rejections.slice(1).map((reason, ridx) => (
                                <li key={`${release.title}-${ridx}`}>{reason}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            )}
          </>
        )}
      </article>
    );
  }

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
          <div className="two-col-grid">{state.wanted.map((movie) => renderWantedMovie(movie))}</div>
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
