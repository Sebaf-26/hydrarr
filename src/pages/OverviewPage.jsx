import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

export default function OverviewPage() {
  const [state, setState] = useState({ loading: true, error: "", items: [] });
  const [hideNotConfigured, setHideNotConfigured] = useState(false);

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "", items: [] });

    apiFetch("/api/overview")
      .then((json) => {
        if (active) setState({ loading: false, error: "", items: json.items || [] });
      })
      .catch((err) => {
        if (active) setState({ loading: false, error: err.message, items: [] });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <header className="page-header">
        <h2>Overview</h2>
      </header>
      <button
        type="button"
        className="action-btn"
        onClick={() => setHideNotConfigured((prev) => !prev)}
      >
        {hideNotConfigured ? "Show not configured" : "Hyde not configured"}
      </button>

      {state.loading && <p>Loading services...</p>}
      {state.error && <p className="error">{state.error}</p>}

      <div className="grid">
        {state.items
          .filter((item) => (hideNotConfigured ? item.configured : true))
          .map((item) => (
          <article className="card" key={item.service}>
            <div className="row">
              <h3>{item.service.toUpperCase()}</h3>
              <span className={`service-state service-state-${item.status}`}>{item.status.replace("_", " ")}</span>
            </div>
            <p className="muted">{item.message}</p>
            <p className="muted">
              Configured: {item.configured ? "Yes" : "No"}
              {item.version ? ` | Version: ${item.version}` : ""}
            </p>
            {item.configured && item.url && (
              <a className="action-btn" href={item.url} target="_blank" rel="noreferrer">
                Open app
              </a>
            )}
          </article>
          ))}
      </div>
    </section>
  );
}
