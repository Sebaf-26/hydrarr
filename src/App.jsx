import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import CategoryPage from "./pages/CategoryPage";
import ErrorsPage from "./pages/ErrorsPage";
import MoviesPage from "./pages/MoviesPage";
import OverviewPage from "./pages/OverviewPage";
import TvPage from "./pages/TvPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/tv" element={<TvPage />} />
        <Route path="/movies" element={<MoviesPage />} />
        <Route path="/music" element={<CategoryPage category="music" title="Music" />} />
        <Route path="/debugging" element={<ErrorsPage />} />
        <Route path="/errors" element={<Navigate to="/debugging" replace />} />
      </Routes>
    </Layout>
  );
}
