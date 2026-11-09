CREATE TABLE "menu_shares" (
	"token" varchar(43) PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_entry_id" varchar(256) NOT NULL,
	"payload_version" integer NOT NULL,
	"snapshot_json" text NOT NULL,
	"snapshot_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_shares_token_format" CHECK (("menu_shares"."token" ~ '^[A-Za-z0-9_-]{43}$')),
	CONSTRAINT "menu_shares_payload_version" CHECK (("menu_shares"."payload_version" = 1)),
	CONSTRAINT "menu_shares_snapshot_digest_format" CHECK (("menu_shares"."snapshot_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "menu_shares_snapshot_json_bytes" CHECK ((octet_length("menu_shares"."snapshot_json") <= 2097152)),
	CONSTRAINT "menu_shares_finite_created_at" CHECK ((isfinite("menu_shares"."created_at")))
);
--> statement-breakpoint
ALTER TABLE "menu_shares" ADD CONSTRAINT "menu_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_shares_source_snapshot_key" ON "menu_shares" USING btree ("owner_id","source_entry_id","payload_version","snapshot_digest");
