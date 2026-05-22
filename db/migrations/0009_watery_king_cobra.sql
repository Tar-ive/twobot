ALTER TABLE "impressions" ADD COLUMN "dwell_ms" integer;--> statement-breakpoint
ALTER TABLE "impressions" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "impressions" ADD COLUMN "scroll_depth" integer;