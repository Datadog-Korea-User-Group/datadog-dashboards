import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("footer");
  return (
    <footer className="border-t border-border bg-bg mt-8">
      <div className="max-w-7xl mx-auto px-4 py-5 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between text-xs muted">
        <span>{t("builtBy")} · <a className="link" href="https://github.com/Datadog-Korea-User-Group/datadog-dashboards">{t("source")}</a></span>
        <span>{t("notice")}</span>
      </div>
    </footer>
  );
}
