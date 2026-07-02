ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_worker_id_work_date_unique";--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "shift_sequence" integer;--> statement-breakpoint
-- Backfill: every existing row was the only shift for its worker+workDate
-- (enforced by the unique constraint just dropped), so it's shift 1 of that day.
UPDATE "attendance_records" SET "shift_sequence" = 1 WHERE "shift_sequence" IS NULL;