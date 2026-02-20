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

function DownloadMeta({ download }) {
  if (!download) return null;
  return (
    <div className="download-stats-wrap">
      <ProgressRing value={download.progressPct} />
      <div className="download-stats">
        <span>ETA: {formatEta(download.etaSeconds)}</span>
        <span>Peers: {download.peers}</span>
        <span>GB: {download.sizeGb}</span>
        <span>Stalled: {download.isStalled ? "Yes" : "No"}</span>
        {download.isStalled && <span>Stalled For: {formatDuration(download.stalledSeconds)}</span>}
      </div>
    </div>
  );
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
  const [releaseState, setReleaseState] = useState({});
  const [hasRejectedMap, setHasRejectedMap] = useState({});

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

  useEffect(() => {
    const targets = state.wanted.filter((series) => series.status === "wanted");
    if (!targets.length) {
      setHasRejectedMap({});
      return;
    }

    let active = true;
    const itemIds = targets.map((series) => series.id).join(",");
    apiFetch(`/api/releases/has-rejected/batch?service=sonarr&itemIds=${itemIds}`)
      .then((json) => {
        if (!active) return;
        const payload = json.items || {};
        const next = {};
        for (const series of targets) {
          next[series.id] = Boolean(payload[String(series.id)]);
        }
        setHasRejectedMap(next);
      })
      .catch(() => {
        if (active) setHasRejectedMap({});
      });

    return () => {
      active = false;
    };
  }, [state.wanted]);

  function toggleSeries(seriesId) {
    setOpenSeries((prev) => ({ ...prev, [seriesId]: !prev[seriesId] }));
  }

  function toggleInteractive(service, itemId) {
    const key = `${service}-${itemId}`;
    const current = releaseState[key];
    if (current?.loaded) {
      setReleaseState((prev) => ({
        ...prev,
        [key]: { ...current, open: !current.open }
      }));
      return;
    }

    setReleaseState((prev) => ({
      ...prev,
      [key]: { loading: true, loaded: false, open: true, error: "", items: [] }
    }));

    apiFetch(`/api/releases?service=${service}&itemId=${itemId}`)
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

  async function grabRelease(service, release, key) {
    setReleaseState((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || {}), grabbing: true, grabError: "", grabMessage: "" }
    }));
    try {
      const res = await fetch("/api/releases/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, release: release.full })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Grab failed");
      }
      setReleaseState((prev) => ({
        ...prev,
        [key]: { ...(prev[key] || {}), grabbing: false, grabError: "", grabMessage: "Release sent." }
      }));
    } catch (err) {
      setReleaseState((prev) => ({
        ...prev,
        [key]: { ...(prev[key] || {}), grabbing: false, grabError: err.message, grabMessage: "" }
      }));
    }
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
    const releaseKey = `sonarr-${series.id}`;
    const rel = releaseState[releaseKey];
    const canShowInteractive = series.status === "wanted" && hasRejectedMap[series.id];
    return (
      <article className="card media-card" key={series.id}>
        <div className="row media-top-row">
          <StatusPill status={series.status} />
          <div className="episodes-pill-wrap">
            <span className="episodes-pill">
              {series.episodeFileCount}/{series.totalEpisodes}
            </span>
            {series.missingEpisodes > 0 && <span className="episodes-missing">Missing: {series.missingEpisodes}</span>}
          </div>
        </div>

        <div className="title-row">
          <h3>{series.title}</h3>
          {canShowInteractive && (
            <button type="button" className="action-btn action-btn-inline" onClick={() => toggleInteractive("sonarr", series.id)}>
              {rel?.open ? "Hide Interactive Search" : "Interactive Search"}
            </button>
          )}
        </div>
        <DownloadMeta download={series.download} />

        {canShowInteractive && (
          <>
            {rel?.open && (
              <div className="release-list">
                {rel.loading && <p className="muted">Loading rejected releases...</p>}
                {rel.error && <p className="error">{rel.error}</p>}
                {rel.grabMessage && <p className="muted">{rel.grabMessage}</p>}
                {rel.grabError && <p className="error">{rel.grabError}</p>}
                {!rel.loading && !rel.error && rel.loaded && rel.items.length === 0 && (
                  <p className="muted">No rejected releases found.</p>
                )}
                {!rel.loading &&
                  rel.items?.map((release, idx) => (
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
                        <span className="rel-state rel-rejected">Rejected</span>
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => grabRelease("sonarr", release, releaseKey)}
                          disabled={Boolean(rel.grabbing)}
                        >
                          {rel.grabbing ? "Grabbing..." : "Grab"}
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
          </>
        )}

        <button type="button" className="action-btn" onClick={() => toggleSeries(series.id)}>
          {openSeries[series.id] ? "Hide seasons" : "Open seasons"}
        </button>

        {openSeries[series.id] && (
          <div className="expand-area">
            {Array.isArray(series.downloadItems) && series.downloadItems.length > 0 && (
              <div className="download-list">
                {series.downloadItems.map((item, idx) => (
                  <article className="download-item" key={`${item.hash || item.name}-${idx}`}>
                    <div className="download-item-head">
                      <strong>{item.episodeHint ? `${item.episodeHint} ` : ""}{item.name}</strong>
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
            {(series.seasons || []).map((season) => {
              const seasonKey = `${series.id}-${season.seasonNumber}`;
              const seasonInfo = seasonState[seasonKey];
              const seasonStatus = season.status || "wanted";
              const isOpenable = seasonStatus !== "available";
              return (
                <div key={seasonKey} className="expand-line">
                  <button
                    type="button"
                    className={isOpenable ? "expand-btn" : "expand-btn expand-btn-disabled"}
                    onClick={() => {
                      if (isOpenable) toggleSeason(series.id, season.seasonNumber);
                    }}
                    disabled={!isOpenable}
                  >
                    <span>Season {season.seasonNumber}</span>
                    <span className={`season-state season-state-${seasonStatus}`}>
                      {seasonStatus.replace("_", " ")}
                    </span>
                  </button>

                  {isOpenable && seasonInfo?.open && (
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
