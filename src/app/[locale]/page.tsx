import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getHomeData, getSketchWidgets } from "@/db/queries";
import { DashboardCard } from "@/components/DashboardCard";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  const t = await getTranslations("site");
  const th = await getTranslations("home");

  const { total, popular, recent, integrations } = await getHomeData();
  const sketches = await getSketchWidgets(
    [...popular, ...recent].filter((d) => !d.screenshotUrl).map((d) => d.id),
  );

  const grid = (items: typeof popular) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <DashboardCard key={item.id} item={item} sketch={sketches.get(item.id)} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="card p-8">
        <h1 className="text-2xl font-bold">{t("name")}</h1>
        <p className="muted mt-1 text-base">{t("tagline")}</p>
        <p className="mt-3 text-xs text-text-tertiary">
          {th("stats", { count: total.toLocaleString() })} · {th("integrationCount", { count: integrations.length })}
        </p>
        <Link href="/dashboards" className="btn btn-primary mt-4">{th("browseAll")}</Link>
      </section>

      {integrations.length > 0 ? (
        <section>
          <h2 className="font-bold mb-2">{th("byIntegration")}</h2>
          <div className="flex flex-wrap gap-2">
            {integrations.map((i) => (
              <Link
                key={i.name}
                href={`/dashboards?integration=${encodeURIComponent(i.name)}`}
                className="pill pill-brand hover:opacity-80"
              >
                {i.name} · {i.count}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {popular.length > 0 ? (
        <section>
          <h2 className="font-bold mb-3">{th("popular")}</h2>
          {grid(popular)}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section>
          <h2 className="font-bold mb-3">{th("recent")}</h2>
          {grid(recent)}
        </section>
      ) : null}
    </div>
  );
}
