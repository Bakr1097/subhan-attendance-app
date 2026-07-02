CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"day_status" text DEFAULT 'full' NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "payroll_adjustments_worker_id_work_date_unique" UNIQUE("worker_id","work_date")
);
--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "pay_type" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "daily_rate" integer;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;