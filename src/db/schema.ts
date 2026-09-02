import { relations, sql } from "drizzle-orm";
import {
  boolean, customType, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ---------- Auth.js (drizzle adapter) ----------
export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  username: text("username").unique(),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<AdapterAccountType>().notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (t) => [primaryKey({ columns: [t.identifier, t.token] })]);

// ---------- Dashboards ----------
export type ConversionSummary = {
  counts: { total: number; native: number; openmetrics: number; partial: number; unsupported: number };
  unmappedMetrics: { metric: string; count: number }[];
  unsupportedPanels: { title: string; grafanaType: string }[];
  model?: string;
  apiError?: string | null;
};

export const dashboards = pgTable("dashboards", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  readme: text("readme").notNull().default(""),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  integrations: text("integrations").array().notNull().default(sql`'{}'::text[]`),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  source: text("source").notNull().default("user"), // 'user' | 'grafana'
  sourceId: integer("source_id").unique(),
  sourceUrl: text("source_url"),
  sourceOrgName: text("source_org_name"),
  sourceOrgSlug: text("source_org_slug"),
  sourceRevision: integer("source_revision"),
  sourceDownloads: integer("source_downloads").notNull().default(0),
  qualityScore: integer("quality_score"),
  conversionSummary: jsonb("conversion_summary").$type<ConversionSummary>(),
  screenshotUrl: text("screenshot_url"),
  // 'grafana' | 'auto' | 'manual'. Nullable with no default: the seed sets it explicitly.
  screenshotSource: text("screenshot_source"),
  // Datadog dashboard the preview worker reuses across revisions.
  ddDashboardId: text("dd_dashboard_id"),
  downloads: integer("downloads").notNull().default(0),
  views: integer("views").notNull().default(0),
  ratingAvg: numeric("rating_avg", { precision: 3, scale: 2 }),
  ratingCount: integer("rating_count").notNull().default(0),
  // 'pending' | 'approved' | 'rejected'. Existing rows are approved so the seed stays public.
  reviewStatus: text("review_status").notNull().default("approved"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  isPublished: boolean("is_published").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // array_to_tsvector, not to_tsvector(array_to_string(...)): array_to_string is only
  // STABLE, and Postgres rejects a non-IMMUTABLE expression in a generated column.
  search: tsvector("search").generatedAlwaysAs(
    sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B') || setweight(array_to_tsvector(tags), 'C')`,
  ),
}, (t) => [
  index("dashboards_search_idx").using("gin", t.search),
  index("dashboards_tags_idx").using("gin", t.tags),
  index("dashboards_integrations_idx").using("gin", t.integrations),
  index("dashboards_downloads_idx").on(t.downloads),
  index("dashboards_views_idx").on(t.views),
  index("dashboards_source_downloads_idx").on(t.sourceDownloads),
  index("dashboards_created_idx").on(t.createdAt),
  index("dashboards_author_idx").on(t.authorId),
]);

export const dashboardRevisions = pgTable("dashboard_revisions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  dashboardJson: jsonb("dashboard_json").$type<Record<string, unknown>>().notNull(),
  sourceJson: jsonb("source_json").$type<Record<string, unknown>>(),
  conversionReport: jsonb("conversion_report").$type<Record<string, unknown>>(),
  changelog: text("changelog").notNull().default(""),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // 'pending' | 'approved' | 'rejected'. Existing rows are approved so the seed stays public.
  reviewStatus: text("review_status").notNull().default("approved"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("dashboard_revisions_unique").on(t.dashboardId, t.revision)]);

export const ratings = pgTable("ratings", {
  dashboardId: integer("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.dashboardId, t.userId] })]);

export const comments = pgTable("comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Soft delete: the row stays so a thread keeps its shape; listings filter on null.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("comments_dashboard_created_idx").on(t.dashboardId, t.createdAt)]);

export const REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F680}", "\u{1F440}", "\u{1F389}", "\u{1F615}"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const reactions = pgTable("reactions", {
  dashboardId: integer("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One row per person per emoji: the key is the toggle constraint, no app-side check.
  primaryKey({ columns: [t.dashboardId, t.userId, t.emoji] }),
  index("reactions_dashboard_idx").on(t.dashboardId),
]);

/** Work queue for the preview worker. Raw SQL reads this, so the column names are the contract. */
export const previewJobs = pgTable("preview_jobs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  dashboardId: integer("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("preview_jobs_status_created_idx").on(t.status, t.createdAt)]);

// ---------- Relations ----------
export const usersRelations = relations(users, ({ many }) => ({ dashboards: many(dashboards) }));
export const dashboardsRelations = relations(dashboards, ({ one, many }) => ({
  author: one(users, { fields: [dashboards.authorId], references: [users.id] }),
  revisions: many(dashboardRevisions),
  ratings: many(ratings),
  comments: many(comments),
  reactions: many(reactions),
}));
export const dashboardRevisionsRelations = relations(dashboardRevisions, ({ one }) => ({
  dashboard: one(dashboards, { fields: [dashboardRevisions.dashboardId], references: [dashboards.id] }),
}));

export type Dashboard = typeof dashboards.$inferSelect;
export type DashboardRevision = typeof dashboardRevisions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type PreviewJob = typeof previewJobs.$inferSelect;
