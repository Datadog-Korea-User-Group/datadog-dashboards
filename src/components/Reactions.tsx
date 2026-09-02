"use client";

import { useOptimistic, useTransition } from "react";
import type { ReactionTally } from "@/db/queries";

/**
 * Signed in: toggling updates the pill before the server answers.
 * Signed out: every pill is a submit button for the GitHub sign-in action.
 */
export function Reactions({
  dashboardId,
  items,
  signedIn,
  signInHint,
  signIn,
  toggle,
}: {
  dashboardId: number;
  items: ReactionTally[];
  signedIn: boolean;
  signInHint: string;
  signIn: () => Promise<void>;
  toggle: (dashboardId: number, emoji: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [shown, addOptimistic] = useOptimistic(items, (state: ReactionTally[], emoji: string) =>
    state.map((r) => (r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r)),
  );

  if (!signedIn) {
    return (
      <form action={signIn} className="flex flex-wrap gap-1.5">
        {items.map((r) => (
          <button key={r.emoji} type="submit" title={signInHint} className="pill pill-neutral gap-1 h-7 px-2.5">
            <span aria-hidden="true">{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        ))}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((r) => (
        <button
          key={r.emoji}
          type="button"
          disabled={pending}
          aria-pressed={r.mine}
          onClick={() =>
            startTransition(async () => {
              addOptimistic(r.emoji);
              await toggle(dashboardId, r.emoji);
            })
          }
          className={`pill gap-1 h-7 px-2.5 disabled:opacity-60 ${r.mine ? "pill-brand ring-1 ring-brand" : "pill-neutral"}`}
        >
          <span aria-hidden="true">{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
