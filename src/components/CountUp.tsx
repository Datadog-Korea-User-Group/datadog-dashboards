"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rolls a number up from zero once it scrolls into view. Renders the final
 * value on the server so there is no layout shift and no hydration mismatch;
 * the animation only kicks in after mount, and not at all under
 * prefers-reduced-motion.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el || value <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const start = () => {
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 1100);
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      setShown(0);
      raf = requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  // Fixed locale: the server and the browser must format identically.
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {shown.toLocaleString("en-US")}
    </span>
  );
}
