import { NavLink } from "react-router-dom";

const links = [
  { to: "/tv", label: "TV Series" },
  { to: "/movies", label: "Movies" },
  { to: "/music", label: "Music" },
  { to: "/errors", label: "Errors" }
];

export default function Layout({ children }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Hydrarr</h1>
        <p>Unified ARR Control</p>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
