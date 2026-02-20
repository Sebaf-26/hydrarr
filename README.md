# Hydrarr

Hydrarr is a unified ARR dashboard for Sonarr, Radarr, Lidarr, Readarr, Prowlarr, and Bazarr.

## Features

- TV, Movies, and Music overview pages
- Centralized Errors page
- Error filtering by service, level, and search term
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

## License

Apache-2.0
