import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

export default function OverviewPage() {
  const [state, setState] = useState({ loading: true, error: "", items: [] });

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

      {state.loading && <p>Loading services...</p>}
      {state.error && <p className="error">{state.error}</p>}

      <div className="grid">
        {state.items.map((item) => (
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
          </article>
        ))}
      </div>
    </section>
  );
}
