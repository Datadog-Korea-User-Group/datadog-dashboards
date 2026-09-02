import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Flame, Layers, Sparkles } from "lucide-react";
import { absolute, languageAlternates } from "@/lib/site-url";
import { Link } from "@/i18n/navigation";
import { getHomeData, getSketchWidgets } from "@/db/queries";
import { DashboardCard } from "@/components/DashboardCard";
import { HeroArt } from "@/components/HeroArt";
import { CountUp } from "@/components/CountUp";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  const image = { url: `${absolute(locale, "/opengraph-image")}`, width: 1200, height: 630, alt: t("name") };
  return {
    alternates: { canonical: absolute(locale), languages: languageAlternates() },
    openGraph: { type: "website", url: absolute(locale), title: t("name"), description: t("tagline"), siteName: t("name"), images: [image] },
    twitter: { card: "summary_large_image" },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  const t = await getTranslations("site");
  const tn = await getTranslations("nav");
  const th = await getTranslations("home");

  const { total, popular, recent, integrations } = await getHomeData();
  const sketches = await getSketchWidgets(
    [...popular, ...recent].filter((d) => !d.screenshotUrl).map((d) => d.id),
  );

  const grid = (items: typeof popular) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => (
        <DashboardCard key={item.id} item={item} sketch={sketches.get(item.id)} index={i} />
      ))}
    </div>
  );

  const heading = (icon: React.ReactNode, label: string) => (
    <h2 className="flex items-center gap-2 font-bold mb-3">
      {icon}
      {label}
    </h2>
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="card overflow-hidden">
        <div className="grid items-center gap-8 p-8 sm:p-10 lg:grid-cols-[1.05fr_minmax(0,0.95fr)]">
          <div className="reveal">
            <p className="eyebrow">{t("org")}</p>
            <h1 className="text-gradient mt-3 text-[32px] leading-[1.12] font-bold tracking-tight break-keep sm:text-[42px]">
              {th("headline")}
            </h1>
            <p className="muted mt-4 max-w-[46ch] text-base leading-relaxed break-keep">{t("tagline")}</p>

            <div className="mt-7 flex flex-wrap gap-2">
              <Link href="/dashboards" className="btn btn-primary">{th("browseAll")}</Link>
              <Link href="/upload" className="btn btn-secondary">{tn("upload")}</Link>
            </div>

            <dl className="mt-8 flex gap-10">
              <div>
                <dd className="text-gradient text-[28px] leading-none font-bold">
                  <CountUp value={total} />
                </dd>
                <dt className="mt-1.5 text-xs text-text-tertiary">{th("statDashboards")}</dt>
              </div>
              <div>
                <dd className="text-gradient text-[28px] leading-none font-bold">
                  <CountUp value={integrations.length} />
                </dd>
                <dt className="mt-1.5 text-xs text-text-tertiary">{th("statIntegrations")}</dt>
              </div>
            </dl>
          </div>

          <div className="reveal justify-self-center lg:justify-self-end" style={{ "--i": 2 } as React.CSSProperties}>
            <HeroArt className="h-auto w-full max-w-[520px]" />
          </div>
        </div>
      </section>

      {integrations.length > 0 ? (
        <section>
          {heading(<Layers size={16} className="text-primary" aria-hidden="true" />, th("byIntegration"))}
          <div className="flex flex-wrap gap-2">
            {integrations.map((i, idx) => (
              <Link
                key={i.name}
                href={`/dashboards?integration=${encodeURIComponent(i.name)}`}
                className="pill pill-brand reveal hover:opacity-80"
                style={{ "--i": idx } as React.CSSProperties}
              >
                {i.name} · {i.count}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {popular.length > 0 ? (
        <section>
          {heading(<Flame size={16} className="text-callout" aria-hidden="true" />, th("popular"))}
          {grid(popular)}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section>
          {heading(<Sparkles size={16} className="text-brand" aria-hidden="true" />, th("recent"))}
          {grid(recent)}
        </section>
      ) : null}
    </div>
  );
}
