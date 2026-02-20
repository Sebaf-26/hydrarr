import { useEffect, useState } from "react";
import { apiFetch } from "../lib";
import ServiceBadge from "../components/ServiceBadge";

function StatusPill({ status }) {
  return <span className={`media-state media-state-${status}`}>{status}</span>;
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
          <ServiceBadge name="sonarr" />
          <StatusPill status={series.status} />
        </div>

        <h3>{series.title}</h3>
        <p className="muted">
          {series.episodeFileCount}/{series.totalEpisodes} episodes available
          {series.missingEpisodes > 0 ? ` | Missing: ${series.missingEpisodes}` : ""}
        </p>

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
          <div className="grid">{state.wanted.map(renderSeriesCard)}</div>
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
