"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addComment, type CommentState } from "./actions";

const initial: CommentState = { error: null };

export function CommentForm({ dashboardId }: { dashboardId: number }) {
  const t = useTranslations("comments");
  const [state, action, pending] = useActionState(addComment, initial);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="dashboardId" value={dashboardId} />
      {state.error ? (
        <p className="pill pill-danger h-auto py-1.5 px-3 whitespace-normal">{t(`errors.${state.error}`)}</p>
      ) : null}
      <textarea name="body" rows={4} required maxLength={4000} className="textarea" placeholder={t("placeholder")} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">{t("submit")}</button>
        <span className="text-xs muted">{t("markdownHint")}</span>
      </div>
    </form>
  );
}
