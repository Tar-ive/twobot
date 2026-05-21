CREATE TABLE "topic_clusters" (
	"cluster_id" integer PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"centroid" vector(1536),
	"size" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "cluster_id" integer;