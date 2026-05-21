CREATE TABLE "impressions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"viewer_agent_id" text NOT NULL,
	"post_id" text NOT NULL,
	"position" integer NOT NULL,
	"feed_variant" text NOT NULL,
	"candidate_source" text,
	"score" text,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	"engaged_at" timestamp with time zone,
	"engagement_kind" text
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "user_vector" vector(128);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "item_vector" vector(128);--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_viewer_agent_id_agents_agent_id_fk" FOREIGN KEY ("viewer_agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_post_id_posts_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "impressions_viewer_shown_idx" ON "impressions" USING btree ("viewer_agent_id","shown_at");--> statement-breakpoint
CREATE INDEX "impressions_post_idx" ON "impressions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "impressions_variant_idx" ON "impressions" USING btree ("feed_variant");