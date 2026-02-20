import { useEffect, useState } from "react";
import { apiFetch } from "../lib";
import ServiceBadge from "../components/ServiceBadge";

export default function CategoryPage({ category, title }) {
  const [state, setState] = useState({ loading: true, error: "", data: [] });

  useEffect(() => {
    let active = true;
    setState({ loading: true, error: "", data: [] });

    apiFetch(`/api/dashboard/${category}`)
      .then((json) => {
        if (active) setState({ loading: false, error: "", data: json.items || [] });
      })
      .catch((err) => {
        if (active) setState({ loading: false, error: err.message, data: [] });
      });

    return () => {
      active = false;
    };
  }, [category]);

  return (
    <section>
      <header className="page-header">
        <h2>{title}</h2>
      </header>

      {state.loading && <p>Loading data...</p>}
      {state.error && <p className="error">{state.error}</p>}

      <div className="grid">
        {state.data.map((item) => (
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

      {!state.loading && !state.error && state.data.length === 0 && (
        <p>No configured services returned data for this section.</p>
      )}
    </section>
  );
}
