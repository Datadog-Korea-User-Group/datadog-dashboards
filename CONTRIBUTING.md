# Contributing

- Dashboards: sign in on the site and use **Upload**. Please describe what the dashboard needs (integration, metrics, template variables).
- Code: open a PR. `pnpm lint && pnpm typecheck && pnpm test` must pass. Keep UI to the Datadog token set in `src/app/globals.css`.
- Do not commit `.env*`, `.cache/`, or Datadog credentials.
