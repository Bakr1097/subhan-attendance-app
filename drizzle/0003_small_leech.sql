CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" RENAME COLUMN "work_date" TO "closing_date";--> statement-breakpoint
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT "payroll_adjustments_worker_id_work_date_unique";--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_worker_id_closing_date_unique" UNIQUE("worker_id","closing_date");