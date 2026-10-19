-- In-app account deletion (D-117): when the user asked, PII is scrubbed at this time unless they keep the account.
ALTER TABLE "users" ADD COLUMN     "deletionScheduledFor" TIMESTAMPTZ(3);
