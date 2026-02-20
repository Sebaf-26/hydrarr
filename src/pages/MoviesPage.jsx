import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

function StatusPill({ status }) {
  return <span className={`media-state media-state-${status}`}>{status}</span>;
}

function MovieCard({ movie }) {
  return (
    <article className="card media-card" key={movie.id}>
      <div className="row media-top-row">
        <StatusPill status={movie.status} />
      </div>
      <h3>{movie.title}</h3>
      <p className="muted">{movie.summary}</p>
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
