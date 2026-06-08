import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  time,
  date,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const terminals = pgTable("terminals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  terminalId: uuid("terminal_id")
    .notNull()
    .references(() => terminals.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  terminalId: uuid("terminal_id")
    .notNull()
    .references(() => terminals.id),
  name: text("name").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  graceMinutes: integer("grace_minutes").notNull().default(10),
  earlyLeaveGraceMinutes: integer("early_leave_grace_minutes")
    .notNull()
    .default(10),
  crossesMidnight: boolean("crosses_midnight").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<"admin" | "supervisor">().notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const supervisorScopes = pgTable("supervisor_scopes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  terminalId: uuid("terminal_id")
    .notNull()
    .references(() => terminals.id),
  departmentId: uuid("department_id").references(() => departments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const workers = pgTable("workers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  terminalId: uuid("terminal_id")
    .notNull()
    .references(() => terminals.id),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id),
  employeeCode: text("employee_code").notNull().unique(),
  fullName: text("full_name").notNull(),
  cnic: text("cnic"),
  phone: text("phone"),
  pinHash: text("pin_hash").notNull(),
  referencePhotoUrl: text("reference_photo_url"),
  defaultShiftId: uuid("default_shift_id").references(() => shifts.id),
  status: text("status").$type<"active" | "inactive">().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    workDate: date("work_date").notNull(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    workerDateUnique: unique().on(t.workerId, t.workDate),
  })
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    terminalId: uuid("terminal_id")
      .notNull()
      .references(() => terminals.id),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    workDate: date("work_date").notNull(),
    resolvedShiftId: uuid("resolved_shift_id").references(() => shifts.id),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkInPhotoUrl: text("check_in_photo_url"),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    checkOutPhotoUrl: text("check_out_photo_url"),
    status: text("status")
      .$type<"present" | "absent" | "leave">()
      .notNull()
      .default("present"),
    leaveReason: text("leave_reason"),
    isLate: boolean("is_late").notNull().default(false),
    lateMinutes: integer("late_minutes").notNull().default(0),
    leftEarly: boolean("left_early").notNull().default(false),
    earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes"),
    checkoutMissing: boolean("checkout_missing").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    workerDateUnique: unique().on(t.workerId, t.workDate),
  })
);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
