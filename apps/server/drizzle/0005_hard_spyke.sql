CREATE TABLE "model_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"logical_name" text NOT NULL,
	"physical_name" text NOT NULL,
	"domain_id" uuid,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "model_words" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"logical_name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "naming_rules" jsonb DEFAULT '{"case":"UPPER_SNAKE","separator":"_","maxLengthBytes":30}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "model_terms" ADD CONSTRAINT "model_terms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_terms" ADD CONSTRAINT "model_terms_domain_id_model_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."model_domains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_words" ADD CONSTRAINT "model_words_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;