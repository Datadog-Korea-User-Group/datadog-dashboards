"use client";

import { useActionState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createRevision, type RevisionState } from "./actions";

const initial: RevisionState = { error: null };

export function RevisionForm({ slug, json }: { slug: string; json: string }) {
  const t = useTranslations("upload");
  const locale = useLocale();
  const [state, action, pending] = useActionState(createRevision, initial);
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  async function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && jsonRef.current) jsonRef.current.value = await file.text();
  }

  return (
    <form action={action} className="card p-5 flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />

      {state.error ? (
        <p className="pill pill-danger h-auto py-1.5 px-3 whitespace-normal">{t(`errors.${state.error}`)}</p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("changelog")}</span>
        <input name="changelog" maxLength={500} className="input" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("json")}</span>
        <textarea ref={jsonRef} name="json" rows={20} required defaultValue={json} className="textarea font-mono" />
      </label>

      <label className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{t("chooseFile")}</span>
        <input type="file" accept="application/json,.json" onChange={loadFile} className="text-xs" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("screenshot")}</span>
        <span className="text-xs muted">{t("screenshotHelp")}</span>
        <input type="file" name="screenshot" accept="image/png,image/jpeg,image/webp" className="text-xs" />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary self-start">{t("submitRevision")}</button>
    </form>
  );
}
