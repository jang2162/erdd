CREATE TABLE "model_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"logical_type" text NOT NULL,
	"dialect_types" jsonb NOT NULL,
	"default_value" text,
	"allowed_values" jsonb NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "model_columns" ADD COLUMN "domain_id" uuid;--> statement-breakpoint
ALTER TABLE "model_domains" ADD CONSTRAINT "model_domains_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_columns" ADD CONSTRAINT "model_columns_domain_id_model_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."model_domains"("id") ON DELETE no action ON UPDATE no action;