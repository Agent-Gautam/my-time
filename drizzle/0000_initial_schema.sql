CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"daypart_id" uuid NOT NULL,
	"available_minutes" integer NOT NULL,
	"date" date NOT NULL,
	"checked_in_at" timestamp with time zone NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_ins_available_minutes_check" CHECK ("check_ins"."available_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"value" double precision NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dayparts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"active_cap" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dayparts_start_time_check" CHECK ("dayparts"."start_time" ~ '^[0-2][0-9]:[0-5][0-9]$'),
	CONSTRAINT "dayparts_end_time_check" CHECK ("dayparts"."end_time" ~ '^[0-2][0-9]:[0-5][0-9]$'),
	CONSTRAINT "dayparts_active_cap_check" CHECK ("dayparts"."active_cap" >= 0)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"tier" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goals_state_check" CHECK ("goals"."state" in ('planned','active','dropped'))
);
--> statement-breakpoint
CREATE TABLE "plan_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_week_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"date" date NOT NULL,
	"daypart_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "plan_slots_minutes_check" CHECK ("plan_slots"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "plan_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_weeks_user_week_key" UNIQUE("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "session_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"date" date NOT NULL,
	"daypart_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_logs_status_check" CHECK ("session_logs"."status" in ('done','skipped')),
	CONSTRAINT "session_logs_source_check" CHECK ("session_logs"."source" in ('planned','voluntary')),
	CONSTRAINT "session_logs_minutes_check" CHECK ("session_logs"."minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"session_minutes" integer NOT NULL,
	"cadence_type" text NOT NULL,
	"cadence_count" integer NOT NULL,
	"cadence_days" text[],
	"eligible_dayparts" uuid[] NOT NULL,
	"max_per_week" integer,
	"min_rest_days" integer,
	"scope_unit_label" text,
	"scope_unit_total" integer,
	"target_date" date,
	"deadline_derived" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stages_cadence_type_check" CHECK ("stages"."cadence_type" in ('frequency','fixed_days','hybrid')),
	CONSTRAINT "stages_state_check" CHECK ("stages"."state" in ('pending','active','done')),
	CONSTRAINT "stages_session_minutes_check" CHECK ("stages"."session_minutes" > 0),
	CONSTRAINT "stages_cadence_count_check" CHECK ("stages"."cadence_count" >= 0),
	CONSTRAINT "stages_cadence_days_check" CHECK ("stages"."cadence_days" is null or "stages"."cadence_days" <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]),
	CONSTRAINT "stages_cadence_shape_check" CHECK ("stages"."cadence_type" = 'frequency' or ("stages"."cadence_days" is not null and cardinality("stages"."cadence_days") > 0))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dayparts" ADD CONSTRAINT "dayparts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_plan_week_id_plan_weeks_id_fk" FOREIGN KEY ("plan_week_id") REFERENCES "public"."plan_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_slots" ADD CONSTRAINT "plan_slots_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_weeks" ADD CONSTRAINT "plan_weeks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_date_daypart_idx" ON "check_ins" USING btree ("date","daypart_id");--> statement-breakpoint
CREATE INDEX "check_ins_cursor_idx" ON "check_ins" USING btree ("server_updated_at");--> statement-breakpoint
CREATE INDEX "checkpoints_stage_logged_idx" ON "checkpoints" USING btree ("stage_id","logged_at");--> statement-breakpoint
CREATE INDEX "checkpoints_cursor_idx" ON "checkpoints" USING btree ("server_updated_at");--> statement-breakpoint
CREATE INDEX "dayparts_user_idx" ON "dayparts" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX "goals_user_state_idx" ON "goals" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "plan_slots_week_idx" ON "plan_slots" USING btree ("plan_week_id");--> statement-breakpoint
CREATE INDEX "plan_slots_date_daypart_idx" ON "plan_slots" USING btree ("date","daypart_id");--> statement-breakpoint
CREATE INDEX "plan_weeks_cursor_idx" ON "plan_weeks" USING btree ("server_updated_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_logs_stage_date_idx" ON "session_logs" USING btree ("stage_id","date");--> statement-breakpoint
CREATE INDEX "session_logs_date_daypart_idx" ON "session_logs" USING btree ("date","daypart_id");--> statement-breakpoint
CREATE INDEX "session_logs_cursor_idx" ON "session_logs" USING btree ("server_updated_at");--> statement-breakpoint
CREATE INDEX "stages_goal_idx" ON "stages" USING btree ("goal_id","sort_order");--> statement-breakpoint
CREATE INDEX "stages_state_idx" ON "stages" USING btree ("state");