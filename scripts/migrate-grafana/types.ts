// Shared types for the one-time Grafana -> Datadog migration pipeline.

export type GridPos = { x: number; y: number; w: number; h: number };

export type GrafanaTarget = {
  refId?: string; expr?: string; legendFormat?: string; hide?: boolean; instant?: boolean; format?: string; [k: string]: unknown;
};

export type GrafanaPanel = {
  id?: number; type: string; title?: string; description?: string; gridPos?: GridPos; span?: number; height?: string | number;
  targets?: GrafanaTarget[]; panels?: GrafanaPanel[]; collapsed?: boolean; repeat?: string;
  fieldConfig?: { defaults?: Record<string, unknown> }; options?: Record<string, unknown>; [k: string]: unknown;
};

export type GrafanaRow = { title?: string; collapse?: boolean; height?: string | number; panels?: GrafanaPanel[]; showTitle?: boolean; repeat?: string };

export type GrafanaVariable = {
  name: string; type: string; label?: string; query?: unknown; current?: { value?: unknown; text?: unknown };
  options?: { value?: unknown; text?: unknown; selected?: boolean }[]; includeAll?: boolean; multi?: boolean; [k: string]: unknown;
};

export type GrafanaDashboard = {
  title?: string; uid?: string; description?: string; tags?: string[]; schemaVersion?: number;
  panels?: GrafanaPanel[]; rows?: GrafanaRow[]; templating?: { list?: GrafanaVariable[] }; [k: string]: unknown;
};

export type NormType = "timeseries" | "stat" | "gauge" | "bargauge" | "table" | "piechart" | "heatmap" | "text" | "logs" | "row" | "unknown";

export type ThresholdStep = { value: number | null; color: string };

export interface NormTarget { refId: string; expr: string; legendFormat: string; instant: boolean }

export interface NormPanel {
  kind: "panel";
  id: number;
  type: NormType;
  rawType: string;
  title: string;
  description: string;
  grid: GridPos;
  targets: NormTarget[];
  unit?: string;
  thresholds?: ThresholdStep[];
  calcs?: string[];
  drawStyle?: "line" | "bars" | "points";
  stacking?: boolean;
  fill?: number;
  content?: string;
  graphMode?: string;
  raw: GrafanaPanel;
}

export interface Group { kind: "group"; title: string; grid: GridPos; panels: NormPanel[] }
export type TopLevel = NormPanel | Group;

export interface NormalizedDashboard {
  title: string;
  description: string;
  tags: string[];
  schemaVersion: number;
  legacyRows: boolean;
  items: TopLevel[];
  variables: GrafanaVariable[];
  warnings: string[];
}

// ---------- LLM translation ----------
export type Status = "native" | "openmetrics" | "partial" | "unsupported";
export const STATUS_RANK: Record<Status, number> = { native: 0, openmetrics: 1, partial: 2, unsupported: 3 };

export interface TranslationRequest {
  id: string;             // `${panelId}.${refId}`
  expr: string;           // normalized PromQL
  panel: { title: string; type: NormType; unit?: string; legendFormat?: string };
  variables: { name: string; prefix: string }[];
}

export interface DatadogQuery { name: string; query: string; aggregator?: "avg" | "sum" | "min" | "max" | "last" }

export interface TranslationResult {
  id: string;
  status: Status;
  queries: DatadogQuery[];
  formula: string;
  tagRenames?: Record<string, string>;
  unmappedMetrics: string[];
  notes: string[];
}

// ---------- Report ----------
export interface ConversionReport {
  title: string;
  grafanaId: number;
  schemaVersion: number;
  legacyRows: boolean;
  model: string;
  counts: { total: number; native: number; openmetrics: number; partial: number; unsupported: number };
  score: number;
  panels: {
    id: number; title: string; grafanaType: string; datadogType: string; status: Status;
    targets: { expr: string; status: Status; queries?: string[]; formula?: string; notes: string[] }[];
  }[];
  unmappedMetrics: { metric: string; count: number; panelIds: number[] }[];
  templateVariables: { converted: string[]; dropped: { name: string; type: string; reason: string }[] };
  warnings: string[];
  llm: { calls: number; retries: number; validationFailures: number; cached: number };
}

// Minimal Datadog dashboard JSON types (subset we emit).
export type DdLayout = { x: number; y: number; width: number; height: number };
export type DdWidget = { definition: Record<string, unknown> & { type: string }; layout: DdLayout };
export interface DdDashboard {
  title: string;
  description: string;
  layout_type: "ordered";
  reflow_type: "fixed";
  tags: string[];
  template_variables: { name: string; prefix: string; default: string; available_values: string[] }[];
  widgets: DdWidget[];
}
