import { useEffect, useState } from "react";
import { apiFetch } from "../lib";

async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export default function MusicPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [overview, setOverview] = useState({
    loading: true,
    error: "",
    configured: true,
    artists: [],
    albums: []
  });
  const [plexCfg, setPlexCfg] = useState({ loading: true, error: "", configured: false });
  const [plexToken, setPlexToken] = useState("");
  const [uploadId, setUploadId] = useState("");
  const [playlists, setPlaylists] = useState([]);
  const [playlistId, setPlaylistId] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [previewMsg, setPreviewMsg] = useState("");
  const [resultMsg, setResultMsg] = useState("");
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [file, setFile] = useState(null);

  useEffect(() => {
    let active = true;
    setOverview({ loading: true, error: "", configured: true, artists: [], albums: [] });

    apiFetch("/api/music/overview")
      .then((json) => {
        if (!active) return;
        setOverview({
          loading: false,
          error: "",
          configured: Boolean(json.configured),
          artists: json.artists || [],
          albums: json.albums || []
        });
      })
      .catch((err) => {
        if (active) {
          setOverview({ loading: false, error: err.message, configured: true, artists: [], albums: [] });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPlexCfg({ loading: true, error: "", configured: false });
    apiFetch("/api/integrations/plex-playlist-reorder")
      .then((json) => {
        if (!active) return;
        setPlexCfg({ loading: false, error: "", configured: Boolean(json.plexConfigured) });
      })
      .catch((err) => {
        if (!active) return;
        setPlexCfg({ loading: false, error: err.message, configured: false });
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadPlaylists(tokenArg = plexToken) {
    const res = await fetch("/api/plex-reorder/api/playlists", {
      headers: tokenArg ? { "X-Plex-Token": tokenArg } : {}
    });
    const json = await readJsonSafe(res);
    if (!res.ok) throw new Error(json.error || "Failed to load playlists");
    const items = Array.isArray(json.playlists) ? json.playlists : [];
    setPlaylists(items);
  }

  async function startPlexLogin() {
    setAuthMsg("Opening Plex login...");
    try {
      const res = await fetch("/api/plex-reorder/api/auth/plex/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forwardUrl: `${window.location.origin}/api/plex-reorder/auth/plex/callback` })
      });
      const json = await readJsonSafe(res);
      if (!res.ok) throw new Error(json.error || "Failed to start Plex OAuth");

      const popup = window.open(json.authUrl, "plex-oauth-login", "width=520,height=760");
      if (!popup) throw new Error("Popup blocked. Enable popups and retry.");
      setAuthMsg("Complete login in popup...");

      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusRes = await fetch(
          `/api/plex-reorder/api/auth/plex/status?sessionId=${encodeURIComponent(json.sessionId)}`
        );
        const statusJson = await readJsonSafe(statusRes);
        if (!statusRes.ok) throw new Error(statusJson.error || "OAuth check failed");
        if (statusJson.loggedIn) {
          setPlexToken(statusJson.plexToken || "");
          setAuthMsg("Plex login completed.");
          await loadPlaylists(statusJson.plexToken || "");
          return;
        }
      }
      throw new Error("Plex login timed out.");
    } catch (err) {
      setAuthMsg(err.message);
    }
  }

  async function uploadFile() {
    if (!file) {
      setUploadMsg("Select a file first.");
      return;
    }
    setUploadMsg("Uploading...");
    setPreview(null);
    setPreviewMsg("");
    setResultMsg("");

    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/plex-reorder/api/upload", { method: "POST", body: form });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setUploadMsg(json.error || "Upload failed");
      return;
    }
    setUploadId(json.uploadId || "");
    setUploadMsg(`Upload complete: ${json.tracks || 0} tracks parsed.`);
  }

  async function previewOrder() {
    if (!uploadId) {
      setPreviewMsg("Upload your Apple Music file first.");
      return;
    }
    if (!playlistId) {
      setPreviewMsg("Please select a Plex playlist.");
      return;
    }
    setPreviewMsg("Loading preview...");
    const headers = { "Content-Type": "application/json" };
    if (plexToken) headers["X-Plex-Token"] = plexToken;
    const res = await fetch("/api/plex-reorder/api/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ uploadId, playlistId })
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setPreviewMsg(json.error || "Preview failed");
      return;
    }
    setPreview(json);
    setPreviewMsg("");
  }

  async function applyReorder() {
    if (!uploadId || !playlistId) {
      setResultMsg("Missing upload or selected playlist.");
      return;
    }
    if (!confirm) {
      setResultMsg("Please confirm before apply.");
      return;
    }
    setResultMsg("Applying reorder...");
    const headers = { "Content-Type": "application/json" };
    if (plexToken) headers["X-Plex-Token"] = plexToken;
    const res = await fetch("/api/plex-reorder/api/reorder", {
      method: "POST",
      headers,
      body: JSON.stringify({ uploadId, playlistId, confirm: true })
    });
    const json = await readJsonSafe(res);
    if (!res.ok) {
      setResultMsg(json.error || "Reorder failed");
      return;
    }
    setResultMsg(
      `Reorder completed: ${json.playlistTitle}. Ordered: ${json.ordered}, matches: ${json.matches}, missing: ${json.missing}`
    );
  }

  return (
    <section>
      <header className="page-header">
        <h2>Music</h2>
      </header>

      <div className="music-submenu">
        <button
          type="button"
          className={activeTab === "overview" ? "music-submenu-btn music-submenu-btn-active" : "music-submenu-btn"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          className={activeTab === "plex-reorder" ? "music-submenu-btn music-submenu-btn-active" : "music-submenu-btn"}
          onClick={() => setActiveTab("plex-reorder")}
        >
          Plex Playlist Reorderer
        </button>
      </div>

      {activeTab === "overview" && (
        <>
          {overview.loading && <p>Loading music data...</p>}
          {overview.error && <p className="error">{overview.error}</p>}
          {!overview.loading && !overview.error && !overview.configured && (
            <p className="error">Lidarr is not configured. Add LIDARR_URL and LIDARR_API_KEY in env.</p>
          )}

          <div className="music-overview-grid">
            <article className="card">
              <h3>Artists</h3>
              <div className="music-overview-list">
                {overview.artists.map((artist) => (
                  <div key={artist.id} className="music-overview-row">
                    <span>{artist.name}</span>
                  </div>
                ))}
              </div>
              {!overview.loading && !overview.error && overview.configured && overview.artists.length === 0 && (
                <p className="muted">No artists found.</p>
              )}
            </article>

            <article className="card">
              <h3>Albums</h3>
              <div className="music-albums-grid">
                {overview.albums.map((album) => (
                  <article key={album.id} className="music-album-card">
                    {album.coverUrl ? (
                      <img className="music-album-cover" src={album.coverUrl} alt={album.title} loading="lazy" />
                    ) : (
                      <div className="music-album-cover music-album-cover-fallback">No Cover</div>
                    )}
                    <div className="music-album-meta">
                      <strong>{album.title}</strong>
                      <span className="muted">{album.artistName}{album.year ? ` • ${album.year}` : ""}</span>
                    </div>
                  </article>
                ))}
              </div>
              {!overview.loading && !overview.error && overview.configured && overview.albums.length === 0 && (
                <p className="muted">No albums found.</p>
              )}
            </article>
          </div>
        </>
      )}

      {activeTab === "plex-reorder" && (
        <div className="music-native-wrap">
          {plexCfg.loading && <p>Checking Plex integration...</p>}
          {plexCfg.error && <p className="error">{plexCfg.error}</p>}
          {!plexCfg.loading && !plexCfg.error && !plexCfg.configured && (
            <p className="error">
              Set <code>PLEX_URL</code> in environment to enable Plex Playlist Reorderer.
            </p>
          )}
          {!plexCfg.loading && !plexCfg.error && plexCfg.configured && (
            <>
              <article className="card">
                <h3>0) Plex Login</h3>
                <button type="button" className="action-btn" onClick={startPlexLogin}>
                  Sign in with Plex
                </button>
                {authMsg && <p className="muted">{authMsg}</p>}
              </article>

              <article className="card">
                <h3>1) Upload Apple Music File</h3>
                <input
                  type="file"
                  accept=".txt,.csv"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <div>
                  <button type="button" className="action-btn" onClick={uploadFile}>
                    Upload
                  </button>
                </div>
                {uploadMsg && <p className="muted">{uploadMsg}</p>}
              </article>

              <article className="card">
                <h3>2) Select Plex Playlist</h3>
                <div className="row">
                  <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                    <option value="">Select...</option>
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} ({p.count})
                      </option>
                    ))}
                  </select>
                  <button type="button" className="action-btn" onClick={() => loadPlaylists()}>
                    Reload Playlists
                  </button>
                  <button type="button" className="action-btn" onClick={previewOrder}>
                    Preview Order
                  </button>
                </div>
                {previewMsg && <p className="muted">{previewMsg}</p>}
                {preview && (
                  <div className="music-preview-grid">
                    <p><strong>Playlist:</strong> {preview.playlistTitle}</p>
                    <p><strong>Matches:</strong> {preview.matches} / {preview.uploadedCount || 0}</p>
                    <p><strong>Missing in Plex:</strong> {preview.missingTotal || 0}</p>
                  </div>
                )}
              </article>

              <article className="card">
                <h3>3) Confirm</h3>
                <label className="check">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  Are you sure? Apply reorder now
                </label>
                <div>
                  <button type="button" className="action-btn" onClick={applyReorder}>
                    Apply Reorder
                  </button>
                </div>
                {resultMsg && <p className="muted">{resultMsg}</p>}
              </article>
            </>
          )}
        </div>
      )}
    </section>
  );
}
