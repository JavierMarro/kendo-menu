-- Reviewed: unqualified references intentionally follow the migration connection search_path.
CREATE TABLE "application_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_token_hash" varchar(64) NOT NULL,
	"csrf_token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "application_sessions_finite_timestamps" CHECK ((isfinite("application_sessions"."created_at") AND isfinite("application_sessions"."last_activity_at") AND isfinite("application_sessions"."idle_expires_at") AND isfinite("application_sessions"."absolute_expires_at") AND ("application_sessions"."revoked_at" IS NULL OR isfinite("application_sessions"."revoked_at")))),
	CONSTRAINT "application_sessions_session_token_hash_format" CHECK (("application_sessions"."session_token_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "application_sessions_csrf_token_hash_format" CHECK (("application_sessions"."csrf_token_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "application_sessions_timestamp_order" CHECK (("application_sessions"."created_at" <= "application_sessions"."last_activity_at" AND "application_sessions"."last_activity_at" <= "application_sessions"."idle_expires_at" AND "application_sessions"."idle_expires_at" <= "application_sessions"."absolute_expires_at" AND "application_sessions"."created_at" < "application_sessions"."absolute_expires_at")),
	CONSTRAINT "application_sessions_revocation_order" CHECK (("application_sessions"."revoked_at" IS NULL OR "application_sessions"."revoked_at" >= "application_sessions"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "login_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"browser_binding_hash" varchar(64),
	"nonce_hash" varchar(64),
	"pkce_code_verifier" varchar(128),
	"return_path" varchar(2048) DEFAULT '/',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "login_transactions_finite_timestamps" CHECK ((isfinite("login_transactions"."created_at") AND isfinite("login_transactions"."expires_at") AND ("login_transactions"."consumed_at" IS NULL OR isfinite("login_transactions"."consumed_at")))),
	CONSTRAINT "login_transactions_callback_material" CHECK ((
      ("login_transactions"."consumed_at" IS NULL AND "login_transactions"."browser_binding_hash" IS NOT NULL AND "login_transactions"."nonce_hash" IS NOT NULL AND "login_transactions"."pkce_code_verifier" IS NOT NULL AND "login_transactions"."return_path" IS NOT NULL)
      OR ("login_transactions"."consumed_at" IS NOT NULL AND "login_transactions"."browser_binding_hash" IS NULL AND "login_transactions"."nonce_hash" IS NULL AND "login_transactions"."pkce_code_verifier" IS NULL AND "login_transactions"."return_path" IS NULL)
    )),
	CONSTRAINT "login_transactions_state_hash_format" CHECK (("login_transactions"."state_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "login_transactions_browser_binding_hash_format" CHECK (("login_transactions"."browser_binding_hash" IS NULL OR "login_transactions"."browser_binding_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "login_transactions_nonce_hash_format" CHECK (("login_transactions"."nonce_hash" IS NULL OR "login_transactions"."nonce_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "login_transactions_pkce_verifier_format" CHECK (("login_transactions"."pkce_code_verifier" IS NULL OR ("login_transactions"."pkce_code_verifier" ~ '^[A-Za-z0-9._~-]{43,128}$'))),
	CONSTRAINT "login_transactions_return_path_format" CHECK (("login_transactions"."return_path" IS NULL OR ("login_transactions"."return_path" <> '' AND "login_transactions"."return_path" LIKE '/%' AND "login_transactions"."return_path" NOT LIKE '//%' AND position(chr(92) in "login_transactions"."return_path") = 0 AND "login_transactions"."return_path" !~ '[[:cntrl:]]'))),
	CONSTRAINT "login_transactions_expiry_order" CHECK (("login_transactions"."expires_at" > "login_transactions"."created_at" AND "login_transactions"."expires_at" <= "login_transactions"."created_at" + INTERVAL '10 minutes')),
	CONSTRAINT "login_transactions_consumed_order" CHECK (("login_transactions"."consumed_at" IS NULL OR ("login_transactions"."consumed_at" >= "login_transactions"."created_at" AND "login_transactions"."consumed_at" <= "login_transactions"."expires_at")))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" varchar(255) NOT NULL,
	"verified_google_email" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_sub_no_controls" CHECK (("users"."google_sub" <> '' AND "users"."google_sub" !~ '[[:cntrl:]]')),
	CONSTRAINT "users_verified_google_email_no_controls" CHECK (("users"."verified_google_email" IS NULL OR ("users"."verified_google_email" <> '' AND "users"."verified_google_email" !~ '[[:cntrl:]]'))),
	CONSTRAINT "users_timestamp_order" CHECK ((isfinite("users"."created_at") AND isfinite("users"."updated_at") AND "users"."updated_at" >= "users"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "application_sessions" ADD CONSTRAINT "application_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_sessions_session_token_hash_key" ON "application_sessions" USING btree ("session_token_hash");--> statement-breakpoint
CREATE INDEX "application_sessions_user_id_idx" ON "application_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "application_sessions_active_expiry_idx" ON "application_sessions" USING btree ("revoked_at","idle_expires_at","absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "login_transactions_state_hash_key" ON "login_transactions" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "login_transactions_expiry_idx" ON "login_transactions" USING btree ("expires_at","consumed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_key" ON "users" USING btree ("google_sub");
--> statement-breakpoint
-- Google subject is immutable even for direct SQL updates. No account deletion policy is added.
CREATE FUNCTION reject_google_subject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.google_sub IS DISTINCT FROM OLD.google_sub THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GOOGLE_SUB_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_google_sub_immutable
BEFORE UPDATE OF google_sub ON "users"
FOR EACH ROW EXECUTE FUNCTION reject_google_subject_change();
