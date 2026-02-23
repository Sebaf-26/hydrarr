# Hydrarr

Hydrarr is a unified ARR dashboard for Sonarr, Radarr, Lidarr, Readarr, Prowlarr, and Bazarr.

## Features

- TV, Movies, and Music overview pages
- Centralized Errors page
- Error filtering by service, level, and search term
- Optional qBittorrent integration for live download details (progress, ETA, stalled, peers, GB)
- Optional Plex Playlist Reorderer embed in Music section
- Runtime configuration via `.env` (ideal for Portainer Git Repository deployment)

## Environment variables

Copy `.env.example` to `.env` and fill in service URLs and API keys.

## Local run

```bash
npm install
npm run build
npm run start
```

Then open `http://localhost:3000`.

## Portainer (Git repository)

1. In Portainer, choose **Stacks** > **Add stack** > **Repository**.
2. Repository URL: `https://github.com/Sebaf-26/hydrarr`
3. Compose path: `docker-compose.yml`
4. Define environment variables from `.env.example` in the Env section.
5. Deploy stack.

### Portainer Env example

```env
PORT=3000
NODE_ENV=production
VITE_API_BASE_URL=

SONARR_URL=http://sonarr:8989
SONARR_API_KEY=your_sonarr_api_key

RADARR_URL=http://radarr:7878
RADARR_API_KEY=your_radarr_api_key

LIDARR_URL=http://lidarr:8686
LIDARR_API_KEY=your_lidarr_api_key

READARR_URL=http://readarr:8787
READARR_API_KEY=your_readarr_api_key

PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=your_prowlarr_api_key

BAZARR_URL=http://bazarr:6767
BAZARR_API_KEY=your_bazarr_api_key

QBITTORRENT_URL=http://qbittorrent:8080
QBITTORRENT_USERNAME=admin
QBITTORRENT_PASSWORD=your_qbittorrent_password

# Optional: Overseerr integration
OVERSEERR_URL=http://overseerr:5055
OVERSEERR_API_KEY=your_overseerr_api_key

# Optional: PlexPlaylistReorder integration in /music
# Plex server URL used by plex-playlist-reorder service
PLEX_URL=http://YOUR_PLEX_IP:32400
# Host port where plex-playlist-reorder is exposed
PLEX_REORDER_PORT=8090
# Optional public URL override (useful behind reverse proxy)
PLEX_REORDER_PUBLIC_URL=
```

`plex-playlist-reorder` is bundled in this repository under
`integrations/plex-playlist-reorder` and is built locally by docker compose.

## License

Apache-2.0
