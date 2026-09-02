# Grafana → Datadog migration (one-time)

Converts the grafana.com community dashboards that use a Prometheus datasource into Datadog dashboard JSON,
validates each one against the real Datadog API, feeds dummy metrics so they render, and captures screenshots.
Structure (layout, template variables, widget types, JSON assembly) is deterministic code; only the semantic part —
PromQL → Datadog metric queries and metric-name mapping — is done by an LLM through the local `claude -p` CLI.

```
fetch.ts        grafana.com API -> .cache/grafana/{id}.json           (catalog + dashboard JSON, resumable)
normalize.ts    legacy rows, type aliases, row grouping
layout.ts       24 -> 12 columns, gravity packing (Datadog "ordered" layout places widgets in array order)
variables.ts    templating -> template_variables, $var / interval normalization
extract.ts      one TranslationRequest per (panel, target); global dedupe key
llm.ts          claude -p call: JSON schema output, expression cache (.cache/llm/expr), retries, backoff
prompt/         system prompt, few-shot examples, native metric cheat sheets (mappings/*.json)
validate.ts     Datadog query grammar + formula checks; IN-clause normalization
assemble.ts     widget skeletons + translations -> Datadog JSON + ConversionReport (quality score)
convert.ts      single dashboard CLI        convert-all.ts  batch, resumable, summary
dd-create.ts    create/update in a Datadog org (Bearer PAT or API+app key), dashboard list
dd-feed.ts      DogStatsD dummy metrics derived from the converted queries (+ percentile enablement)
dd-capture.ts   public share -> Playwright 1920x1080 -> webp -> unshare
dd-pipeline.ts  waves: create -> feed -> capture -> stop, resumable (--follow waits for new conversions)
```

## Run

```sh
pnpm migrate:fetch                                   # ~5.8k dashboards, ~440 MB
pnpm migrate:convert --model opus --top 100 --concurrency 3
pnpm migrate:convert --model sonnet --skip 100 --concurrency 4
pnpm migrate:one 1860 --model opus --print            # debug one dashboard
pnpm migrate:dd --batch 50 --feed-minutes 18 --follow # needs DD_* and DOGSTATSD_HOST in .env.local
pnpm seed                                             # .cache -> database (idempotent)
```

Environment (`.env.local`, never committed): `DD_PAT` **or** `DD_API_KEY` + `DD_APP_KEY`, `DD_SITE`, `DOGSTATSD_HOST`, `DOGSTATSD_PORT`.

## Notes

- Translations are cached per normalized expression, so identical PromQL across dashboards is translated once.
- Anything the LLM cannot express becomes a `note` widget carrying the original PromQL; the report lists it.
- Datadog dashboard-level `tags` only accept `team:`/`ai:` keys, so Grafana tags live in the site database instead.
- Custom-metric cost is controlled by feeding each wave for a short window and stopping right after capture.
- Percentile (`pNN:`) queries need percentile aggregation on the distribution metric; the feeder enables it through the metric tag-configuration API.
