import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("footer");
  return (
    <footer className="glass-bar mt-8" style={{ borderTop: "1px solid var(--glass-border)", borderBottom: 0 }}>
      <div className="max-w-7xl mx-auto px-4 py-5 text-xs muted">{t("builtBy")}</div>
    </footer>
  );
}
