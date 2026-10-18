CREATE TABLE "cloud_dashboards" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"transport_version" integer NOT NULL,
	"catalogue_digest" varchar(64) NOT NULL,
	"dashboard_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cloud_dashboards_revision_positive" CHECK (("cloud_dashboards"."revision" > 0)),
	CONSTRAINT "cloud_dashboards_transport_version" CHECK (("cloud_dashboards"."transport_version" = 1)),
	CONSTRAINT "cloud_dashboards_catalogue_digest_format" CHECK (("cloud_dashboards"."catalogue_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "cloud_dashboards_dashboard_json_bytes" CHECK ((octet_length("cloud_dashboards"."dashboard_json") <= 2097152)),
	CONSTRAINT "cloud_dashboards_finite_timestamps" CHECK ((isfinite("cloud_dashboards"."created_at") AND isfinite("cloud_dashboards"."updated_at"))),
	CONSTRAINT "cloud_dashboards_timestamp_order" CHECK (("cloud_dashboards"."updated_at" >= "cloud_dashboards"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "dashboard_write_receipts" (
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"acknowledged_revision" bigint NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_write_receipts_pk" PRIMARY KEY("user_id","request_id"),
	CONSTRAINT "dashboard_write_receipts_request_digest_format" CHECK (("dashboard_write_receipts"."request_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "dashboard_write_receipts_request_id_format" CHECK (("dashboard_write_receipts"."request_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
	CONSTRAINT "dashboard_write_receipts_revision_positive" CHECK (("dashboard_write_receipts"."acknowledged_revision" > 0)),
	CONSTRAINT "dashboard_write_receipts_finite_timestamps" CHECK ((isfinite("dashboard_write_receipts"."acknowledged_at") AND isfinite("dashboard_write_receipts"."created_at"))),
	CONSTRAINT "dashboard_write_receipts_timestamp_order" CHECK (("dashboard_write_receipts"."acknowledged_at" >= "dashboard_write_receipts"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "cloud_dashboards" ADD CONSTRAINT "cloud_dashboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_write_receipts" ADD CONSTRAINT "dashboard_write_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_write_receipts_user_revision_key" ON "dashboard_write_receipts" USING btree ("user_id","acknowledged_revision");