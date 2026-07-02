ALTER TABLE "workers" ADD COLUMN "device_user_id" text;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_device_user_id_unique" UNIQUE("device_user_id");