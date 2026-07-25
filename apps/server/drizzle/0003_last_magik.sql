CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"revision_seq" integer NOT NULL,
	"model" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;