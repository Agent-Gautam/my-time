-- Deterministic row ids become `text` (see src/db/ids.ts).
--
-- Four kinds of row are created with ids derived from their content rather than a
-- random UUID, so that two devices producing "the same" row produce the same id and
-- last-write-wins merging (D45) resolves instead of duplicating:
--
--   users.id        'local-user'                  one user, one row, never forked
--   dayparts.id     'daypart-morning' ...         two devices seeding would give eight
--   plan_weeks.id   'week-<weekStart>'            D45 swaps the week wholesale
--   plan_slots.id   'plan-<stageId>-<date>'       D54 is expressed as this id colliding
--
-- Every FK pointing at those, plus stages.eligible_dayparts (an array OF daypart ids),
-- has to move with them.
--
-- HAND-EDITED, deliberately. `drizzle-kit generate` emits these ALTERs one column at a
-- time, which Postgres rejects the instant an FK pair straddles the change:
--   foreign key constraint "check_ins_daypart_id_dayparts_id_fk" cannot be implemented
--   DETAIL: Key columns "daypart_id" and "id" are of incompatible types: uuid and text.
-- So the constraints are dropped, every column is converted, and the constraints are
-- recreated with their original ON DELETE behaviour. Regenerating this file blindly
-- will reintroduce the failure.

--> statement-breakpoint
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "check_ins" DROP CONSTRAINT "check_ins_daypart_id_dayparts_id_fk";--> statement-breakpoint
ALTER TABLE "dayparts" DROP CONSTRAINT "dayparts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "plan_slots" DROP CONSTRAINT "plan_slots_plan_week_id_plan_weeks_id_fk";--> statement-breakpoint
ALTER TABLE "plan_slots" DROP CONSTRAINT "plan_slots_daypart_id_dayparts_id_fk";--> statement-breakpoint
ALTER TABLE "plan_weeks" DROP CONSTRAINT "plan_weeks_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "session_logs" DROP CONSTRAINT "session_logs_daypart_id_dayparts_id_fk";--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "dayparts" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "dayparts" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "dayparts" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "check_ins" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "check_ins" ALTER COLUMN "daypart_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "session_logs" ALTER COLUMN "daypart_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_weeks" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_weeks" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "plan_weeks" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_slots" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_slots" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "plan_slots" ALTER COLUMN "plan_week_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_slots" ALTER COLUMN "daypart_id" SET DATA TYPE text;--> statement-breakpoint

-- uuid[] -> text[] has no assignment cast, so this one needs USING.
ALTER TABLE "stages" ALTER COLUMN "eligible_dayparts" SET DATA TYPE text[] USING "eligible_dayparts"::text[];--> statement-breakpoint

ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dayparts" ADD CONSTRAINT "dayparts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_plan_week_id_plan_weeks_id_fk" FOREIGN KEY ("plan_week_id") REFERENCES "public"."plan_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;
