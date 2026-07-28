CREATE TABLE "resource_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"library_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_libraries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"org_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_custom_fields" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "model_domains" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "model_terms" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "model_words" ADD COLUMN "origin" jsonb;--> statement-breakpoint
ALTER TABLE "resource_items" ADD CONSTRAINT "resource_items_library_id_resource_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."resource_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_libraries" ADD CONSTRAINT "resource_libraries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;