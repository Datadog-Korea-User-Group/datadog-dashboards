ALTER TABLE "dashboard_revisions" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboard_revisions" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "dashboard_revisions" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "dashboard_revisions" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "review_status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dashboard_revisions" ADD CONSTRAINT "dashboard_revisions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;