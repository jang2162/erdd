CREATE TABLE "promotion_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"library_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"entity_ids" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text DEFAULT '' NOT NULL,
	"approved_entity_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotion_requests" ADD CONSTRAINT "promotion_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_requests" ADD CONSTRAINT "promotion_requests_library_id_resource_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."resource_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_requests" ADD CONSTRAINT "promotion_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_requests" ADD CONSTRAINT "promotion_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_promotion_requests_library_status" ON "promotion_requests" USING btree ("library_id","status");--> statement-breakpoint
CREATE INDEX "ix_promotion_requests_project" ON "promotion_requests" USING btree ("project_id");