# Datadog Dashboards

Community-shared Datadog dashboards, run by the Datadog Korea User Group.
Browse, download, and import dashboard JSON; sign in with GitHub to publish your own.

## Stack

Next.js 16 · Tailwind v4 (Datadog UI tokens) · Drizzle + Postgres 16 · Auth.js (GitHub) · next-intl (en/ko) · Docker Compose.

## Develop

```sh
pnpm install
cp .env.example .env.local            # fill AUTH_* and DATABASE_URL
docker compose up -d db               # local Postgres on 127.0.0.1:5432
pnpm db:migrate
pnpm dev                              # http://localhost:3000
```

`pnpm lint`, `pnpm typecheck`, `pnpm test` mirror CI.

## Deploy (docker compose)

Images are built on push to `main` and published to `ghcr.io/datadog-korea-user-group/datadog-dashboards:latest`.
On the host, put `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_URL`, `SITE_URL`, `POSTGRES_PASSWORD` in a `.env`
next to `docker-compose.yml`, then:

```sh
docker compose pull && docker compose up -d
```

Migrations run automatically on container start. The web container listens on `127.0.0.1:3010`; put your reverse proxy
(TLS termination) in front of it. Back up with `docker compose exec db pg_dump -U dashboards dashboards | gzip > backup.sql.gz`.

## Initial data (one-time Grafana migration)

`scripts/migrate-grafana/` converted the grafana.com Prometheus community dashboards into Datadog JSON (structure by code,
PromQL translation by an LLM via local `claude -p`), created each one in a Datadog org to validate it, fed dummy metrics,
and captured the screenshots in `public/screenshots/`. Converted dashboards credit and link to the original author on grafana.com.
See [scripts/migrate-grafana/README.md](scripts/migrate-grafana/README.md).

## License

MIT
