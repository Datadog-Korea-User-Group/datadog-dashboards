ALTER TABLE "dashboards" ADD COLUMN "views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "dashboards_views_idx" ON "dashboards" USING btree ("views");