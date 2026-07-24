CREATE TABLE "model_columns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"logical_name" text NOT NULL,
	"physical_name" text NOT NULL,
	"type" text NOT NULL,
	"is_pk" boolean NOT NULL,
	"auto_increment" boolean NOT NULL,
	"nullable" boolean NOT NULL,
	"default_value" text,
	"order" integer NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "model_indexes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"name" text NOT NULL,
	"columns" jsonb NOT NULL,
	"unique" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"content" text NOT NULL,
	"position" jsonb NOT NULL,
	"color" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_table_id" uuid NOT NULL,
	"child_table_id" uuid NOT NULL,
	"column_mappings" jsonb NOT NULL,
	"cardinality" text NOT NULL,
	"identifying" boolean NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "model_table_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "model_tables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"logical_name" text NOT NULL,
	"physical_name" text NOT NULL,
	"comment" text,
	"group_id" uuid,
	"position" jsonb NOT NULL,
	"group_position" jsonb
);
--> statement-breakpoint
CREATE TABLE "revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"ops" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_columns" ADD CONSTRAINT "model_columns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_columns" ADD CONSTRAINT "model_columns_table_id_model_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."model_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_indexes" ADD CONSTRAINT "model_indexes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_indexes" ADD CONSTRAINT "model_indexes_table_id_model_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."model_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_notes" ADD CONSTRAINT "model_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_relationships" ADD CONSTRAINT "model_relationships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_relationships" ADD CONSTRAINT "model_relationships_parent_table_id_model_tables_id_fk" FOREIGN KEY ("parent_table_id") REFERENCES "public"."model_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_relationships" ADD CONSTRAINT "model_relationships_child_table_id_model_tables_id_fk" FOREIGN KEY ("child_table_id") REFERENCES "public"."model_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_table_groups" ADD CONSTRAINT "model_table_groups_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_tables" ADD CONSTRAINT "model_tables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_tables" ADD CONSTRAINT "model_tables_group_id_model_table_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."model_table_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_revisions_project_seq" ON "revisions" USING btree ("project_id","seq");