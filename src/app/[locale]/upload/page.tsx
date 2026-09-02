import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth, signIn } from "@/auth";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function UploadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("upload");
  const tn = await getTranslations("nav");
  const session = await auth();

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="muted text-sm">{t("subtitle")}</p>
      </div>

      {session?.user ? (
        <UploadForm />
      ) : (
        <div className="card p-8 text-center flex flex-col items-center gap-3">
          <p className="muted">{t("errors.signIn")}</p>
          <form action={async () => { "use server"; await signIn("github"); }}>
            <button type="submit" className="btn btn-primary">{tn("signIn")}</button>
          </form>
        </div>
      )}
    </div>
  );
}
