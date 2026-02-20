import { useEffect, useMemo, useState } from "react";
import { apiFetch, toTitle } from "../lib";
import ServiceBadge from "../components/ServiceBadge";

export default function ErrorsPage() {
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState("all");
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [search, setSearch] = useState("");
  const [state, setState] = useState({ loading: true, error: "", items: [] });

  useEffect(() => {
    apiFetch("/api/services")
      .then((json) => setServices(json.services || []))
      .catch(() => setServices([]));
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (selectedService !== "all") params.set("service", selectedService);
    if (selectedLevel !== "all") params.set("level", selectedLevel);
    if (search.trim()) params.set("search", search.trim());

    setState({ loading: true, error: "", items: [] });
    apiFetch(`/api/errors?${params.toString()}`)
      .then((json) => {
        if (active) setState({ loading: false, error: "", items: json.items || [] });
      })
      .catch((err) => {
        if (active) setState({ loading: false, error: err.message, items: [] });
      });

    return () => {
      active = false;
    };
  }, [selectedService, selectedLevel, search]);

  const levels = useMemo(() => ["all", "fatal", "error", "warn", "info"], []);

  return (
    <section>
      <header className="page-header">
        <h2>Debugging</h2>
      </header>

      <div className="filters">
        <label>
          Service
          <select value={selectedService} onChange={(e) => setSelectedService(e.target.value)}>
            <option value="all">All</option>
            {services.map((service) => (
              <option key={service} value={service}>
                {service.toUpperCase()}
              </option>
            ))}
          </select>
        </label>

        <label>
          Level
          <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)}>
            {levels.map((level) => (
              <option key={level} value={level}>
                {toTitle(level)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Search
          <input
            type="text"
            value={search}
            placeholder="Filter message..."
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {state.loading && <p>Loading logs...</p>}
      {state.error && <p className="error">{state.error}</p>}

      <div className="log-list">
        {state.items.map((item, idx) => (
          <article key={`${item.service}-${item.time}-${idx}`} className="log-item">
            <div className="row">
              <ServiceBadge name={item.service} />
              <span className={`level level-${item.level}`}>{item.level.toUpperCase()}</span>
              <time className="muted">{item.time || "Unknown time"}</time>
            </div>
            <p>{item.message || "No message"}</p>
          </article>
        ))}
      </div>

      {!state.loading && !state.error && state.items.length === 0 && <p>No matching logs.</p>}
    </section>
  );
}
