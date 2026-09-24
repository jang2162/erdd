DROP INDEX "ix_resource_items_library_id";--> statement-breakpoint
CREATE INDEX "ix_resource_items_library_kind" ON "resource_items" USING btree ("library_id","kind");