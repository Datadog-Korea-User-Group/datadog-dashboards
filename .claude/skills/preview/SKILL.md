---
name: preview
description: Generate previews for dashboards waiting in the site's preview queue (creates them in the community Datadog org, feeds dummy metrics, captures a screenshot, uploads it). Admin only; needs SITE_URL, ADMIN_API_TOKEN and Datadog keys in .env.local.
---

# /preview — generate dashboard previews from the admin queue

1. Sanity-check the environment: `.env.local` must define `SITE_URL` (or `PREVIEW_SITE_URL` pointing at the production site when `SITE_URL` is a local dev URL), `ADMIN_API_TOKEN`, `DD_API_KEY` + `DD_APP_KEY` (or `DD_PAT`), `DD_SITE`, `DOGSTATSD_HOST`. Playwright's Chromium must be installed (`pnpm exec playwright install chromium`).
2. Show what is queued first: run `pnpm preview:run --dry` and summarize the jobs (id, slug, revision).
3. Unless the user only wanted the list, run `pnpm preview:run --limit <N>` (default 5, each job takes about `PREVIEW_FEED_MINUTES` + 1 minutes; run it in the background with the log in `.cache/preview-run.log` and report progress). Options: `--minutes <m>` to change the dummy-metric feed window.
4. Report per job: done (screenshot URL) or failed (error). Failed jobs go back to the queue once; on the second failure they stay `failed` and can be re-queued from the admin page ("Regenerate preview").

Never print the token or Datadog keys. Do not commit anything from this skill.
