CREATE TABLE "account_adoptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"state" varchar(16) NOT NULL,
	"creating_session_id" uuid,
	"decision" varchar(3),
	"request_id" uuid,
	"request_digest" varchar(64),
	"acknowledged_revision" bigint,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_adoptions_state_values" CHECK (("account_adoptions"."state" IN ('pending', 'unavailable', 'accepted', 'declined'))),
	CONSTRAINT "account_adoptions_decision_values" CHECK (("account_adoptions"."decision" IS NULL OR "account_adoptions"."decision" IN ('yes', 'no'))),
	CONSTRAINT "account_adoptions_state_shape" CHECK ((
        ("account_adoptions"."state" = 'pending' AND "account_adoptions"."creating_session_id" IS NOT NULL AND "account_adoptions"."decision" IS NULL AND "account_adoptions"."request_id" IS NULL AND "account_adoptions"."request_digest" IS NULL AND "account_adoptions"."acknowledged_revision" IS NULL AND "account_adoptions"."acknowledged_at" IS NULL)
        OR ("account_adoptions"."state" = 'unavailable' AND "account_adoptions"."creating_session_id" IS NULL AND "account_adoptions"."decision" IS NULL AND "account_adoptions"."request_id" IS NULL AND "account_adoptions"."request_digest" IS NULL AND "account_adoptions"."acknowledged_revision" IS NULL AND "account_adoptions"."acknowledged_at" IS NULL)
        OR ("account_adoptions"."state" = 'accepted' AND "account_adoptions"."creating_session_id" IS NULL AND "account_adoptions"."decision" = 'yes' AND "account_adoptions"."request_id" IS NOT NULL AND "account_adoptions"."request_digest" IS NOT NULL AND "account_adoptions"."acknowledged_revision" IS NOT NULL AND "account_adoptions"."acknowledged_at" IS NOT NULL)
        OR ("account_adoptions"."state" = 'declined' AND "account_adoptions"."creating_session_id" IS NULL AND "account_adoptions"."decision" = 'no' AND "account_adoptions"."request_id" IS NOT NULL AND "account_adoptions"."request_digest" IS NOT NULL AND "account_adoptions"."acknowledged_revision" IS NULL AND "account_adoptions"."acknowledged_at" IS NULL)
      ) IS TRUE),
	CONSTRAINT "account_adoptions_request_digest_format" CHECK (("account_adoptions"."request_digest" IS NULL OR "account_adoptions"."request_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "account_adoptions_request_id_format" CHECK (("account_adoptions"."request_id" IS NULL OR "account_adoptions"."request_id"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
	CONSTRAINT "account_adoptions_acknowledged_revision_positive" CHECK (("account_adoptions"."acknowledged_revision" IS NULL OR "account_adoptions"."acknowledged_revision" > 0)),
	CONSTRAINT "account_adoptions_finite_timestamps" CHECK ((isfinite("account_adoptions"."created_at") AND isfinite("account_adoptions"."updated_at") AND ("account_adoptions"."acknowledged_at" IS NULL OR isfinite("account_adoptions"."acknowledged_at")))),
	CONSTRAINT "account_adoptions_timestamp_order" CHECK (("account_adoptions"."updated_at" >= "account_adoptions"."created_at")),
	CONSTRAINT "account_adoptions_acknowledged_at_order" CHECK (("account_adoptions"."acknowledged_at" IS NULL OR "account_adoptions"."acknowledged_at" >= "account_adoptions"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "account_adoptions" ADD CONSTRAINT "account_adoptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_adoptions" ADD CONSTRAINT "account_adoptions_creating_session_id_application_sessions_id_fk" FOREIGN KEY ("creating_session_id") REFERENCES "application_sessions"("id") ON DELETE restrict ON UPDATE no action;
