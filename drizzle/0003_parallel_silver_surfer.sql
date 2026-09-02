CREATE TABLE "preview_jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "preview_jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dashboard_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "screenshot_source" text;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "dd_dashboard_id" text;--> statement-breakpoint
ALTER TABLE "preview_jobs" ADD CONSTRAINT "preview_jobs_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "preview_jobs_status_created_idx" ON "preview_jobs" USING btree ("status","created_at");