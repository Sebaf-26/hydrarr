import { useEffect, useState } from "react";
import { apiFetch } from "../lib";
import ServiceBadge from "../components/ServiceBadge";

function StatusPill({ status }) {
  return <span className={`media-state media-state-${status}`}>{status}</span>;
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
          [key]: { loading: false, error: "", open: true, episodes: json.items || [] }
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
              return (
                <div key={seasonKey} className="expand-line">
                  <button
                    type="button"
                    className="expand-btn"
                    onClick={() => toggleSeason(series.id, season.seasonNumber)}
                  >
                    Season {season.seasonNumber}
                  </button>

                  {seasonInfo?.open && (
                    <div className="episodes-list">
                      {seasonInfo.loading && <p className="muted">Loading episodes...</p>}
                      {seasonInfo.error && <p className="error">{seasonInfo.error}</p>}
                      {!seasonInfo.loading && !seasonInfo.error && (
                        <ul>
                          {seasonInfo.episodes.map((ep) => (
                            <li key={ep.id}>
                              E{String(ep.episodeNumber).padStart(2, "0")} - {ep.title} ({ep.status})
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
          <div className="grid">{state.wanted.map(renderSeriesCard)}</div>

          <h3 className="section-title">Available</h3>
          <div className="grid">{state.available.map(renderSeriesCard)}</div>
        </>
      )}
    </section>
  );
}
