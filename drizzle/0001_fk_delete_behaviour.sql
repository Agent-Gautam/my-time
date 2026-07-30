ALTER TABLE "checkpoints" DROP CONSTRAINT "checkpoints_stage_id_stages_id_fk";
--> statement-breakpoint
ALTER TABLE "session_logs" DROP CONSTRAINT "session_logs_stage_id_stages_id_fk";
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_stage_id_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."stages"("id") ON DELETE cascade ON UPDATE no action;