import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("footer");
  return (
    <footer className="glass-bar border-t border-b-0 mt-8" style={{ borderTop: "1px solid var(--glass-border)" }}>
      <div className="max-w-7xl mx-auto px-4 py-5 text-xs muted">
        <span>{t("builtBy")} · <a className="link" href="https://github.com/Datadog-Korea-User-Group/datadog-dashboards">{t("source")}</a></span>
      </div>
    </footer>
  );
}
