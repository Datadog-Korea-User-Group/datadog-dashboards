"use client";

import { useActionState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createDashboard, type UploadState } from "./actions";

const initial: UploadState = { error: null };

export function UploadForm() {
  const t = useTranslations("upload");
  const locale = useLocale();
  const [state, action, pending] = useActionState(createDashboard, initial);
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  async function loadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file && jsonRef.current) jsonRef.current.value = await file.text();
  }

  return (
    <form action={action} className="card p-5 flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />

      {state.error ? (
        <p className="pill pill-danger h-auto py-1.5 px-3 whitespace-normal">{t(`errors.${state.error}`)}</p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("name")}</span>
        <input name="title" required minLength={3} maxLength={120} className="input" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("description")}</span>
        <input name="description" maxLength={500} className="input" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("tags")}</span>
        <input name="tags" className="input" placeholder="kubernetes, nginx" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("readme")}</span>
        <textarea name="readme" rows={6} className="textarea font-mono" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold">{t("json")}</span>
        <span className="text-xs muted">{t("jsonHelp")}</span>
        <textarea ref={jsonRef} name="json" rows={12} required className="textarea font-mono" />
      </label>

      <label className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{t("chooseFile")}</span>
        <input type="file" accept="application/json,.json" onChange={loadFile} className="text-xs" />
      </label>

      <button type="submit" disabled={pending} className="btn btn-primary self-start">{t("submit")}</button>
    </form>
  );
}
