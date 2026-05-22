ALTER TABLE "posts" ADD COLUMN "target_viewer_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "generation_source" text;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_target_viewer_id_agents_agent_id_fk" FOREIGN KEY ("target_viewer_id") REFERENCES "public"."agents"("agent_id") ON DELETE set null ON UPDATE no action;