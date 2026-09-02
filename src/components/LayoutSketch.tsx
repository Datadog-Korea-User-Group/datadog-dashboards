type Layout = { x: number; y: number; width: number; height: number };
type SketchWidget = { layout?: Layout; definition?: { type?: string; widgets?: SketchWidget[] } };

const COLS = 12;
const VW = 1920;
const VH = 1080;
const GAP = 6;
// ponytail: hard cap, a sketch of 60 boxes already reads as "busy dashboard".
const MAX_WIDGETS = 60;

function isLayout(v: unknown): v is Layout {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((k) => typeof l[k] === "number");
}

function toWidgets(input: unknown): SketchWidget[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_WIDGETS).flatMap((w) => {
    if (typeof w !== "object" || w === null) return [];
    const o = w as Record<string, unknown>;
    if (!isLayout(o.layout)) return [];
    const def = (typeof o.definition === "object" && o.definition !== null ? o.definition : {}) as Record<string, unknown>;
    return [{
      layout: o.layout,
      definition: { type: typeof def.type === "string" ? def.type : undefined, widgets: toWidgets(def.widgets) },
    }];
  });
}

function rowsOf(widgets: SketchWidget[]): number {
  return Math.max(1, ...widgets.map((w) => (w.layout!.y + w.layout!.height)));
}

function Rects({ widgets, ox, oy, cw, rh, depth }: { widgets: SketchWidget[]; ox: number; oy: number; cw: number; rh: number; depth: number }) {
  return widgets.map((w, i) => {
    const l = w.layout!;
    const x = ox + l.x * cw;
    const y = oy + l.y * rh;
    const width = Math.max(2, l.width * cw - GAP);
    const height = Math.max(2, l.height * rh - GAP);
    const children = w.definition?.widgets ?? [];
    return (
      <g key={i}>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={6}
          fill={depth === 0 ? "var(--ui-background)" : "var(--ui-background-secondary)"}
          stroke="var(--ui-border)"
          strokeWidth={2}
        />
        {children.length > 0 ? (
          <Rects
            widgets={children}
            ox={x + GAP}
            oy={y + GAP * 3}
            cw={(width - GAP * 2) / COLS}
            rh={(height - GAP * 4) / rowsOf(children)}
            depth={depth + 1}
          />
        ) : null}
      </g>
    );
  });
}

/**
 * Screenshot stand-in: draws each widget's grid slot as a box on a 16:9 canvas.
 * `widgets` is the `widgets` array of a Datadog dashboard export (unknown shape, narrowed here).
 */
export function LayoutSketch({ widgets, className = "" }: { widgets: unknown; className?: string }) {
  const parsed = toWidgets(widgets);
  const rh = VH / rowsOf(parsed);
  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className={`w-full aspect-video bg-bg-secondary ${className}`}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <Rects widgets={parsed} ox={0} oy={0} cw={VW / COLS} rh={rh} depth={0} />
    </svg>
  );
}
