import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import CategoryPage from "./pages/CategoryPage";
import ErrorsPage from "./pages/ErrorsPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/tv" replace />} />
        <Route path="/tv" element={<CategoryPage category="tv" title="TV Series" />} />
        <Route path="/movies" element={<CategoryPage category="movies" title="Movies" />} />
        <Route path="/music" element={<CategoryPage category="music" title="Music" />} />
        <Route path="/errors" element={<ErrorsPage />} />
      </Routes>
    </Layout>
  );
}
