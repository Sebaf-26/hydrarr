# Plex Playlist Reorder (Apple Music -> Plex)

Dockerized web app for Portainer that:
- uploads an Apple Music export file (TXT/CSV, Unicode),
- signs in to Plex via OAuth (PIN flow),
- lists non-smart Plex audio playlists,
- previews track matching,
- asks for explicit confirmation,
- reorders a Plex playlist through the Plex move API.

## Requirements
- Plex Media Server reachable from the container network.
- `PLEX_BASEURL` configured correctly.
- Plex OAuth login through the UI.

## Environment
Copy `.env.example` to `.env` and configure:

```env
PLEX_BASEURL=http://YOUR_PLEX_IP:32400
MAX_UPLOAD_MB=8
HOST_PORT=8090
PORT=8080
```

Notes:
- `HOST_PORT` is the host-side port exposed by Docker.
- `PORT` is the internal container port.

## Run locally
```bash
docker compose up --build -d
```
Then open: `http://localhost:8090`

## Deploy with Portainer (Repository mode)
1. Create a new stack and choose `Repository`.
2. Select `docker-compose.yml` as compose path.
3. In Environment, set at least:
   - `PLEX_BASEURL=http://YOUR_PLEX_IP:32400`
   - `HOST_PORT` (for example `8090`, `8091`, ...)
   - optional: `MAX_UPLOAD_MB`, `PORT`
4. Deploy the stack.
5. Open `http://YOUR_SERVER_IP:HOST_PORT`.

## Apple Music formats supported
- Tabular export with `Name` + `Artist` columns (TXT/CSV, UTF-16 or UTF-8).
- iTunes/Apple Music Italian export with `Nome` + `Artista` columns.
- Fallback plain lines in `Artist - Title` format.

## Current limitations
- Plex smart playlists are not manually reorderable.
- Matching uses `Title + Artist` first, then title-only fallback.
- OAuth token is kept in memory for the current browser session only.
