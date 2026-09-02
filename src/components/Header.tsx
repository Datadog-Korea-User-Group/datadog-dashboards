import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { countPendingReviews } from "@/db/queries";
import { Link } from "@/i18n/navigation";
import { LocaleSwitch } from "./LocaleSwitch";
import { ThemeToggle } from "./ThemeToggle";
import { SearchBar } from "./SearchBar";
import { AuthMenu } from "./AuthMenu";

export async function Header() {
  const t = await getTranslations();
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  const pending = isAdmin ? await countPendingReviews() : 0;
  return (
    <header className="sticky top-0 z-20 glass-bar">
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-4">
        <Link href="/" className="shrink-0">
          <span className="font-bold text-lg tracking-tight text-brand">{t("site.name")}</span>
        </Link>
        <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
          <Link href="/dashboards" className="hover:text-primary">{t("nav.dashboards")}</Link>
          <Link href="/upload" className="hover:text-primary">{t("nav.upload")}</Link>
          {isAdmin ? (
            <Link href="/admin" className="inline-flex items-center gap-1.5 hover:text-primary">
              {t("admin.title")}
              {pending > 0 ? <span className="pill pill-warning">{pending}</span> : null}
            </Link>
          ) : null}
        </nav>
        <div className="flex-1 flex justify-end">
          <SearchBar placeholder={t("nav.search")} />
        </div>
        <div className="flex items-center gap-2">
          <LocaleSwitch label={t("nav.language")} />
          <ThemeToggle label={t("nav.theme")} />
          <AuthMenu signIn={t("nav.signIn")} signOut={t("nav.signOut")} />
        </div>
      </div>
    </header>
  );
}
