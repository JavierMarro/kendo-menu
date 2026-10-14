CREATE TABLE "account_copy_opportunities" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"consumed_at" timestamp with time zone,
	"outcome" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_copy_opportunities_outcome_shape" CHECK (((("account_copy_opportunities"."consumed_at" IS NULL AND "account_copy_opportunities"."outcome" IS NULL) OR ("account_copy_opportunities"."consumed_at" IS NOT NULL AND "account_copy_opportunities"."outcome" IN ('consumed', 'accepted', 'declined', 'saved'))) IS TRUE)),
	CONSTRAINT "account_copy_opportunities_finite_timestamps" CHECK ((isfinite("account_copy_opportunities"."created_at") AND ("account_copy_opportunities"."consumed_at" IS NULL OR isfinite("account_copy_opportunities"."consumed_at")))),
	CONSTRAINT "account_copy_opportunities_consumed_order" CHECK (("account_copy_opportunities"."consumed_at" IS NULL OR "account_copy_opportunities"."consumed_at" >= "account_copy_opportunities"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_google_sub_no_controls";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "google_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "managed_provider" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "managed_issuer" varchar(512);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "managed_subject" varchar(255);--> statement-breakpoint
ALTER TABLE "account_copy_opportunities" ADD CONSTRAINT "account_copy_opportunities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_copy_opportunities_id_key" ON "account_copy_opportunities" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_managed_identity_key" ON "users" USING btree ("managed_provider","managed_issuer","managed_subject") WHERE "users"."managed_provider" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_managed_identity_shape" CHECK (((("users"."managed_provider" IS NULL AND "users"."managed_issuer" IS NULL AND "users"."managed_subject" IS NULL) OR ("users"."managed_provider" = 'neon' AND "users"."managed_issuer" IS NOT NULL AND "users"."managed_subject" IS NOT NULL)) IS TRUE));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_no_controls" CHECK (("users"."google_sub" IS NULL OR ("users"."google_sub" <> '' AND "users"."google_sub" !~ '[[:cntrl:]]')));
--> statement-breakpoint
CREATE FUNCTION reject_managed_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.managed_provider IS DISTINCT FROM NEW.managed_provider
    OR OLD.managed_issuer IS DISTINCT FROM NEW.managed_issuer
    OR OLD.managed_subject IS DISTINCT FROM NEW.managed_subject THEN
    RAISE EXCEPTION 'managed identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_managed_identity_immutable
BEFORE UPDATE OF managed_provider, managed_issuer, managed_subject ON users
FOR EACH ROW EXECUTE FUNCTION reject_managed_identity_change();
