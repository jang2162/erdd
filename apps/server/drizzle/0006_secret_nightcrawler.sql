CREATE TABLE "model_custom_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb NOT NULL,
	"required" boolean NOT NULL,
	"default_value" text,
	"order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_columns" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "model_tables" ADD COLUMN "custom" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "model_custom_fields" ADD CONSTRAINT "model_custom_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;