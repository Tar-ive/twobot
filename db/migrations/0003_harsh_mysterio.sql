CREATE TABLE "synthetic_engagements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"post_id" text NOT NULL,
	"action" text NOT NULL,
	"reply_text" text,
	"reason" text,
	"model" text DEFAULT 'MiniMax-M2' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synthetic_engagements" ADD CONSTRAINT "synthetic_engagements_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("agent_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_engagements" ADD CONSTRAINT "synthetic_engagements_post_id_posts_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("post_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "synth_eng_agent_post_idx" ON "synthetic_engagements" USING btree ("agent_id","post_id");--> statement-breakpoint
CREATE INDEX "synth_eng_action_idx" ON "synthetic_engagements" USING btree ("action");