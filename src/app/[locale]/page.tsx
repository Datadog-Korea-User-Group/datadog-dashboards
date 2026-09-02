import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("site");
  const th = await getTranslations("home");
  return (
    <section className="card p-8">
      <h1 className="text-2xl font-bold">{t("name")}</h1>
      <p className="muted mt-1">{t("tagline")}</p>
      <Link href="/dashboards" className="btn btn-primary mt-4">{th("browseAll")}</Link>
    </section>
  );
}
