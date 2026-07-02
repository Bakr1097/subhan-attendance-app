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
  deviceUserId: text("device_user_id").unique(),
  payType: text("pay_type").$type<"daily" | "monthly">().notNull().default("daily"),
  dailyRate: integer("daily_rate"),
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

// Step 19: a worker can have MULTIPLE records on the same workDate (double
// shifts) — no longer unique on (workerId, workDate). shiftSequence (1, 2, …)
// makes same-day records human-readable; which record is "open" right now
// (checkInAt set, checkOutAt null) is what the punch-resolution logic keys
// off of, not workDate.
export const attendanceRecords = pgTable("attendance_records", {
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
  shiftSequence: integer("shift_sequence"),
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
});

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

// Keyed on the CLOSING date (Step 18), not calendar work date — a closing
// settles the rolling window from the previous day's cutoff to this day's
// cutoff. Superseded Step 17's workDate-keyed half-day toggle.
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => workers.id),
    closingDate: date("closing_date").notNull(),
    dayStatus: text("day_status")
      .$type<"full" | "half" | "double" | "absent">()
      .notNull()
      .default("full"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    workerClosingDateUnique: unique().on(t.workerId, t.closingDate),
  })
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
