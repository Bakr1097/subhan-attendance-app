ALTER TABLE "supervisor_scopes" RENAME TO "access_scopes";--> statement-breakpoint
ALTER TABLE "access_scopes" RENAME CONSTRAINT "supervisor_scopes_user_id_users_id_fk" TO "access_scopes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "access_scopes" RENAME CONSTRAINT "supervisor_scopes_terminal_id_terminals_id_fk" TO "access_scopes_terminal_id_terminals_id_fk";--> statement-breakpoint
ALTER TABLE "access_scopes" RENAME CONSTRAINT "supervisor_scopes_department_id_departments_id_fk" TO "access_scopes_department_id_departments_id_fk";
