import "./env";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { dashboardRevisions, dashboards, users, type ConversionSummary } from "../src/db/schema";

const widget = (title: string, x: number, y: number, w = 4, h = 2) => ({
  definition: { type: "note", content: title },
  layout: { x, y, width: w, height: h },
});

const json = (title: string, n: number) => ({
  title,
  layout_type: "ordered" as const,
  widgets: Array.from({ length: n }, (_, i) => widget(`panel ${i + 1}`, (i % 3) * 4, Math.floor(i / 3) * 2)),
});

const summary = (total: number, native: number, partial: number, unsupported: number): ConversionSummary => ({
  counts: { total, native, openmetrics: total - native - partial - unsupported, partial, unsupported },
  unmappedMetrics: [
    { metric: "node_hwmon_temp_celsius", count: 3 },
    { metric: "argocd_app_info", count: 1 },
  ],
  unsupportedPanels: unsupported > 0 ? [{ title: "Alert list", grafanaType: "alertlist" }] : [],
  model: "claude-sonnet-5",
});

const SEED_USER = {
  id: "dev-seed-user",
  name: "Dev Seed",
  email: "dev-seed@example.invalid",
  username: "devseed",
  image: "https://avatars.githubusercontent.com/u/1?v=4",
  role: "user",
};

const rows = [
  {
    slug: "node-exporter-full-1860",
    title: "Node Exporter Full",
    description: "Host metrics from the Prometheus node exporter: CPU, memory, disk, network.",
    tags: ["linux", "node-exporter", "host"],
    integrations: ["system", "disk", "network"],
    source: "grafana",
    sourceId: 1860,
    sourceUrl: "https://grafana.com/grafana/dashboards/1860",
    sourceOrgName: "rfmoz",
    sourceOrgSlug: "rfmoz",
    sourceDownloads: 4_120_000,
    qualityScore: 91,
    conversionSummary: summary(48, 40, 5, 1),
    downloads: 812,
    widgets: 9,
  },
  {
    slug: "kubernetes-cluster-monitoring-315",
    title: "Kubernetes Cluster Monitoring",
    description: "Cluster-wide pod, node and namespace usage converted from the classic Prometheus dashboard.",
    tags: ["kubernetes", "cluster", "prometheus"],
    integrations: ["kubernetes_state", "kubernetes"],
    source: "grafana",
    sourceId: 315,
    sourceUrl: "https://grafana.com/grafana/dashboards/315",
    sourceOrgName: "instrumentisto",
    sourceOrgSlug: "instrumentisto",
    sourceDownloads: 1_980_000,
    qualityScore: 64,
    conversionSummary: summary(31, 14, 12, 3),
    downloads: 407,
    widgets: 6,
  },
  {
    slug: "nginx-ingress-controller-9614",
    title: "NGINX Ingress Controller",
    description: "Request rate, latency percentiles and upstream health for ingress-nginx.",
    tags: ["nginx", "ingress", "kubernetes"],
    integrations: ["nginx_ingress_controller"],
    source: "grafana",
    sourceId: 9614,
    sourceUrl: "https://grafana.com/grafana/dashboards/9614",
    sourceOrgName: "kubernetes",
    sourceOrgSlug: "kubernetes",
    sourceDownloads: 640_000,
    qualityScore: 42,
    conversionSummary: summary(22, 5, 8, 9),
    downloads: 133,
    widgets: 5,
  },
  {
    slug: "postgres-connection-pool-a1b2c3",
    title: "Postgres Connection Pool",
    description: "PgBouncer pool saturation, wait time and client churn.",
    tags: ["postgres", "pgbouncer", "database"],
    integrations: ["postgres"],
    downloads: 58,
    widgets: 7,
  },
  {
    slug: "api-gateway-slo-d4e5f6",
    title: "API Gateway SLO",
    description: "Availability and latency SLO burn rate for the public API gateway.",
    tags: ["slo", "api", "latency"],
    integrations: ["http_check"],
    downloads: 21,
    widgets: 4,
  },
  {
    slug: "redis-keyspace-overview-g7h8i9",
    title: "Redis Keyspace Overview",
    description: "Hit ratio, evictions and memory fragmentation per Redis instance.",
    tags: ["redis", "cache"],
    integrations: ["redisdb"],
    downloads: 96,
    widgets: 8,
  },
] as const;

async function main() {
  await db
    .insert(users)
    .values(SEED_USER)
    .onConflictDoNothing({ target: users.id });

  for (const row of rows) {
    const [existing] = await db.select({ id: dashboards.id }).from(dashboards).where(eq(dashboards.slug, row.slug)).limit(1);
    if (existing) {
      console.log(`skip ${row.slug}`);
      continue;
    }

    const isGrafana = "sourceId" in row;
    const [created] = await db
      .insert(dashboards)
      .values({
        slug: row.slug,
        title: row.title,
        description: row.description,
        readme: `## ${row.title}\n\nSeeded by \`scripts/dev-seed.ts\`.\n\n- Import it into Datadog with **New Dashboard → Import dashboard JSON**\n- Tags: ${row.tags.join(", ")}\n`,
        tags: [...row.tags],
        integrations: [...row.integrations],
        authorId: isGrafana ? null : SEED_USER.id,
        source: isGrafana ? "grafana" : "user",
        sourceId: isGrafana ? row.sourceId : null,
        sourceUrl: isGrafana ? row.sourceUrl : null,
        sourceOrgName: isGrafana ? row.sourceOrgName : null,
        sourceOrgSlug: isGrafana ? row.sourceOrgSlug : null,
        sourceDownloads: isGrafana ? row.sourceDownloads : 0,
        qualityScore: isGrafana ? row.qualityScore : null,
        conversionSummary: isGrafana ? row.conversionSummary : null,
        downloads: row.downloads,
        isPublished: true,
      })
      .returning({ id: dashboards.id });

    await db.insert(dashboardRevisions).values({
      dashboardId: created.id,
      revision: 1,
      dashboardJson: json(row.title, row.widgets),
      changelog: "Initial revision",
      createdBy: isGrafana ? null : SEED_USER.id,
    });
    console.log(`seeded ${row.slug}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
