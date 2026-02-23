import csv
import io
import os
import re
import tempfile
import time
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from plexapi.exceptions import NotFound
from plexapi.myplex import MyPlexPinLogin
from plexapi.server import PlexServer

load_dotenv()

app = Flask(__name__, template_folder="../templates", static_folder="../static")

max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "8"))
app.config["MAX_CONTENT_LENGTH"] = max_upload_mb * 1024 * 1024

UPLOAD_CACHE: dict[str, list[dict[str, str]]] = {}
OAUTH_CACHE: dict[str, dict[str, Any]] = {}
OAUTH_SESSION_TTL_SEC = 10 * 60


@dataclass
class TrackRef:
    title: str
    artist: str


def normalize_text(value: str) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower().strip()
    value = re.sub(r"\s+", " ", value)
    return value


def normalize_key(title: str, artist: str) -> tuple[str, str]:
    return normalize_text(title), normalize_text(artist)


def normalize_title_loose(value: str) -> str:
    v = normalize_text(value)
    # Remove common edition/version noise from titles.
    v = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", v)
    v = re.sub(r"\b(feat|featuring|ft)\.?\b.*$", " ", v)
    v = re.sub(r"[^a-z0-9\s]", " ", v)
    v = re.sub(r"\s+", " ", v).strip()
    return v


def decode_uploaded_bytes(raw: bytes) -> str:
    encodings = ["utf-16", "utf-8-sig", "utf-8", "latin-1"]
    for enc in encodings:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_apple_playlist_text(raw_text: str) -> list[dict[str, str]]:
    lines = [line for line in raw_text.splitlines() if line.strip()]
    if not lines:
        return []

    # Apple Music / iTunes export uses tab-separated values in most locales.
    # Detect tabs first to avoid incorrect delimiter sniffing on date fields.
    first_line = lines[0]
    if "\t" in first_line:
        delimiter = "\t"
    elif ";" in first_line:
        delimiter = ";"
    else:
        delimiter = ","

    reader = csv.DictReader(io.StringIO(raw_text, newline=""), delimiter=delimiter)
    if not reader.fieldnames:
        return []

    normalized_fields = {
        normalize_text((name or "").replace("\ufeff", "").strip()): name
        for name in reader.fieldnames
    }

    def field(*candidates: str) -> str | None:
        for c in candidates:
            norm = normalize_text(c)
            if norm in normalized_fields:
                return normalized_fields[norm]
        return None

    title_field = field("name", "title", "track name", "nome", "titolo")
    artist_field = field("artist", "artist name", "artista")

    if not title_field:
        return []

    parsed: list[dict[str, str]] = []
    for row in reader:
        title = (row.get(title_field) or "").strip()
        artist = (row.get(artist_field) or "").strip() if artist_field else ""
        if title:
            parsed.append({"title": title, "artist": artist})

    # Fallback: plain text one-track-per-line if CSV parse gave nothing.
    if not parsed:
        for line in lines:
            clean = line.strip()
            if not clean:
                continue
            if " - " in clean:
                artist, title = clean.split(" - ", 1)
                parsed.append({"title": title.strip(), "artist": artist.strip()})
            else:
                parsed.append({"title": clean, "artist": ""})

    return parsed


def cleanup_oauth_sessions() -> None:
    now = time.time()
    expired = []
    for session_id, info in OAUTH_CACHE.items():
        if now - info["created_at"] > OAUTH_SESSION_TTL_SEC:
            expired.append(session_id)
    for session_id in expired:
        OAUTH_CACHE.pop(session_id, None)


def resolve_request_token() -> str:
    return (request.headers.get("X-Plex-Token") or "").strip()


def plex_client(token_override: str | None = None) -> PlexServer:
    baseurl = os.getenv("PLEX_BASEURL", "").strip()
    token = (token_override or "").strip()

    if not baseurl or not token:
        raise RuntimeError("Missing PLEX_BASEURL or Plex OAuth token")

    return PlexServer(baseurl=baseurl, token=token)


def resolve_playlist_items(plex: PlexServer, playlist: Any) -> list[Any]:
    # Normal path.
    items = playlist.items() or []
    if items:
        return items

    # Some servers/users expose leafCount but return empty items until reload.
    try:
        playlist.reload()
        items = playlist.items() or []
    except Exception:
        items = []
    if items:
        return items

    # Last fallback: direct query using playlist items key.
    try:
        items_key = getattr(playlist, "itemsKey", "") or f"{playlist.key}/items"
        return plex.fetchItems(items_key) or []
    except Exception:
        return []


def build_reorder_plan(playlist: Any, imported_tracks: list[dict[str, str]]) -> dict[str, Any]:
    plex_items = resolve_playlist_items(playlist._server, playlist)
    leaf_count = int(getattr(playlist, "leafCount", 0) or 0)
    if not plex_items:
        return {
            "matches": 0,
            "missing_in_plex": imported_tracks,
            "new_order_ids": [],
            "new_order_titles": [],
            "current_count": 0,
            "leaf_count": leaf_count,
            "match_breakdown": {
                "exact_title_artist": 0,
                "exact_title_only": 0,
                "loose_title_artist": 0,
                "loose_title_only": 0,
            },
            "plex_sample": [],
        }

    by_title_artist: dict[tuple[str, str], list[Any]] = {}
    by_title: dict[str, list[Any]] = {}
    by_loose_title_artist: dict[tuple[str, str], list[Any]] = {}
    by_loose_title: dict[str, list[Any]] = {}
    plex_meta: list[dict[str, str]] = []

    for item in plex_items:
        title = getattr(item, "title", "") or ""
        artist = getattr(item, "grandparentTitle", "") or getattr(item, "originalTitle", "") or ""
        loose_title = normalize_title_loose(title)
        norm_artist = normalize_text(artist)

        key = normalize_key(title, artist)
        by_title_artist.setdefault(key, []).append(item)
        by_title.setdefault(normalize_text(title), []).append(item)
        by_loose_title_artist.setdefault((loose_title, norm_artist), []).append(item)
        by_loose_title.setdefault(loose_title, []).append(item)
        plex_meta.append({"title": title, "artist": artist})

    used_rating_keys: set[str] = set()
    selected: list[Any] = []
    missing: list[dict[str, str]] = []
    match_breakdown = {
        "exact_title_artist": 0,
        "exact_title_only": 0,
        "loose_title_artist": 0,
        "loose_title_only": 0,
    }

    def pick_unused(bucket: list[Any]) -> Any | None:
        for cand in bucket:
            if cand.ratingKey not in used_rating_keys:
                return cand
        return None

    for track in imported_tracks:
        t_title = track.get("title", "")
        t_artist = track.get("artist", "")
        t_norm_title = normalize_text(t_title)
        t_norm_artist = normalize_text(t_artist)
        t_loose_title = normalize_title_loose(t_title)

        picked = pick_unused(by_title_artist.get((t_norm_title, t_norm_artist), []))
        if picked:
            match_breakdown["exact_title_artist"] += 1

        if not picked:
            picked = pick_unused(by_title.get(t_norm_title, []))
            if picked:
                match_breakdown["exact_title_only"] += 1

        if not picked:
            picked = pick_unused(by_loose_title_artist.get((t_loose_title, t_norm_artist), []))
            if picked:
                match_breakdown["loose_title_artist"] += 1

        if not picked:
            picked = pick_unused(by_loose_title.get(t_loose_title, []))
            if picked:
                match_breakdown["loose_title_only"] += 1

        if picked:
            used_rating_keys.add(picked.ratingKey)
            selected.append(picked)
        else:
            missing.append(track)

    trailing = [item for item in plex_items if item.ratingKey not in used_rating_keys]
    desired = selected + trailing

    return {
        "matches": len(selected),
        "missing_in_plex": missing,
        "new_order_ids": [item.playlistItemID for item in desired],
        "new_order_titles": [
            {
                "title": getattr(item, "title", ""),
                "artist": getattr(item, "grandparentTitle", "") or getattr(item, "originalTitle", "") or "",
            }
            for item in desired
        ],
        "current_count": len(plex_items),
        "leaf_count": leaf_count,
        "match_breakdown": match_breakdown,
        "plex_sample": plex_meta[:30],
    }


@app.errorhandler(413)
def payload_too_large(_: Exception) -> Any:
    if request.path.startswith("/api/"):
        return jsonify({"error": "Uploaded file is too large"}), 413
    return "Payload Too Large", 413


@app.errorhandler(Exception)
def unhandled_api_error(exc: Exception) -> Any:
    if request.path.startswith("/api/"):
        return jsonify({"error": str(exc)}), 500
    return "Internal Server Error", 500


@app.route("/health", methods=["GET"])
def health() -> Any:
    return jsonify({"ok": True})


@app.route("/", methods=["GET"])
def index() -> Any:
    return render_template("index.html")


@app.route("/auth/plex/callback", methods=["GET"])
def plex_auth_callback() -> Any:
    return render_template("auth_callback.html")


@app.route("/api/auth/plex/start", methods=["POST"])
def plex_auth_start() -> Any:
    try:
        cleanup_oauth_sessions()
        payload = request.get_json(silent=True) or {}
        forward_url = (payload.get("forwardUrl") or "").strip() or None

        session_id = str(uuid.uuid4())
        headers = {
            "X-Plex-Product": "Plex Playlist Reorder",
            "X-Plex-Device-Name": "Plex Playlist Reorder Web",
            "X-Plex-Client-Identifier": session_id,
        }
        pinlogin = MyPlexPinLogin(headers=headers, oauth=True)
        auth_url = pinlogin.oauthUrl(forwardUrl=forward_url) if forward_url else pinlogin.oauthUrl()

        OAUTH_CACHE[session_id] = {
            "created_at": time.time(),
            "pinlogin": pinlogin,
        }

        return jsonify({
            "sessionId": session_id,
            "authUrl": auth_url,
            "expiresInSec": OAUTH_SESSION_TTL_SEC,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/auth/plex/status", methods=["GET"])
def plex_auth_status() -> Any:
    cleanup_oauth_sessions()
    session_id = (request.args.get("sessionId") or "").strip()
    if not session_id or session_id not in OAUTH_CACHE:
        return jsonify({"error": "OAuth session not found or expired"}), 400

    info = OAUTH_CACHE[session_id]
    pinlogin: MyPlexPinLogin = info["pinlogin"]

    try:
        if pinlogin.checkLogin():
            token = (pinlogin.token or "").strip()
            OAUTH_CACHE.pop(session_id, None)
            return jsonify({"loggedIn": True, "plexToken": token})
        return jsonify({"loggedIn": False})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/playlists", methods=["GET"])
def playlists() -> Any:
    try:
        plex = plex_client(token_override=resolve_request_token())
        items = []
        for p in plex.playlists():
            if getattr(p, "smart", False):
                continue
            if getattr(p, "playlistType", "") != "audio":
                continue
            items.append({"id": p.ratingKey, "title": p.title, "count": p.leafCount})
        items.sort(key=lambda x: x["title"].lower())
        return jsonify({"playlists": items})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/upload", methods=["POST"])
def upload() -> Any:
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Missing file"}), 400

    raw = file.read()
    text = decode_uploaded_bytes(raw)
    try:
        parsed = parse_apple_playlist_text(text)
    except Exception as exc:
        return jsonify({"error": f"Apple Music file parsing error: {exc}"}), 400

    if not parsed:
        return jsonify({
            "error": "Unsupported format. Use Apple Music export (TXT/CSV) with Name/Artist columns or 'Artist - Title' rows."
        }), 400

    upload_id = str(uuid.uuid4())
    UPLOAD_CACHE[upload_id] = parsed

    return jsonify({
        "uploadId": upload_id,
        "tracks": len(parsed),
        "sample": parsed[:10],
    })


@app.route("/api/preview", methods=["POST"])
def preview() -> Any:
    payload = request.get_json(silent=True) or {}
    upload_id = (payload.get("uploadId") or "").strip()
    playlist_id = str(payload.get("playlistId") or "").strip()

    if not upload_id or upload_id not in UPLOAD_CACHE:
        return jsonify({"error": "Upload not found or expired"}), 400

    if not playlist_id:
        return jsonify({"error": "Missing playlistId"}), 400

    try:
        plex = plex_client(token_override=resolve_request_token())
        playlist = plex.fetchItem(int(playlist_id))

        if getattr(playlist, "smart", False):
            return jsonify({"error": "Selected Plex playlist is smart and cannot be manually reordered"}), 400

        plan = build_reorder_plan(playlist, UPLOAD_CACHE[upload_id])
        tmp_path = Path(tempfile.gettempdir()) / f"plex_reorder_{upload_id}.plan"
        tmp_path.write_text(
            "\n".join(str(pid) for pid in plan["new_order_ids"]),
            encoding="utf-8",
        )

        return jsonify({
            "playlistTitle": playlist.title,
            "matches": plan["matches"],
            "uploadedCount": len(UPLOAD_CACHE[upload_id]),
            "currentCount": plan["current_count"],
            "leafCount": plan["leaf_count"],
            "missingTotal": len(plan["missing_in_plex"]),
            "missingInPlex": plan["missing_in_plex"][:50],
            "importedSample": UPLOAD_CACHE[upload_id][:30],
            "plexSample": plan["plex_sample"],
            "matchBreakdown": plan["match_breakdown"],
            "newOrderPreview": plan["new_order_titles"][:30],
            "planFile": str(tmp_path),
        })
    except NotFound:
        return jsonify({"error": "Playlist not found"}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/reorder", methods=["POST"])
def reorder() -> Any:
    payload = request.get_json(silent=True) or {}
    upload_id = (payload.get("uploadId") or "").strip()
    playlist_id = str(payload.get("playlistId") or "").strip()
    confirm = bool(payload.get("confirm"))

    if not confirm:
        return jsonify({"error": "Confirmation required"}), 400

    if not upload_id or upload_id not in UPLOAD_CACHE:
        return jsonify({"error": "Upload not found or expired"}), 400

    if not playlist_id:
        return jsonify({"error": "Missing playlistId"}), 400

    try:
        plex = plex_client(token_override=resolve_request_token())
        playlist = plex.fetchItem(int(playlist_id))

        if getattr(playlist, "smart", False):
            return jsonify({"error": "Selected Plex playlist is smart and cannot be manually reordered"}), 400

        plan = build_reorder_plan(playlist, UPLOAD_CACHE[upload_id])
        ordered_ids = plan["new_order_ids"]

        playlist_items = {item.playlistItemID: item for item in playlist.items()}
        previous = None

        for item_id in ordered_ids:
            item = playlist_items.get(item_id)
            if not item:
                continue
            if previous is None:
                playlist.moveItem(item)
            else:
                playlist.moveItem(item, after=previous)
            previous = item

        return jsonify({
            "ok": True,
            "playlistTitle": playlist.title,
            "ordered": len(ordered_ids),
            "matches": plan["matches"],
            "missing": len(plan["missing_in_plex"]),
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
