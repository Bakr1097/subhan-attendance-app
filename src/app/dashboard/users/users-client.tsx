"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { PlusCircle, Pencil, KeyRound, UserX, UserCheck } from "lucide-react";
import {
  createUser,
  editUser,
  resetPassword,
  setUserStatus,
  type UserCreatePayload,
  type UserEditPayload,
} from "./actions";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "supervisor";
  isActive: boolean;
  createdAt: string;
  terminalId: string | null;
  departmentId: string | null;
};

type Terminal = { id: string; name: string };
type Department = { id: string; name: string; terminalId: string };

interface UsersClientProps {
  users: UserRow[];
  terminals: Terminal[];
  departments: Department[];
  terminalMap: Record<string, string>;
  deptMap: Record<string, string>;
  currentUserId: string;
}

const emptyCreate = {
  name: "",
  email: "",
  password: "",
  role: "supervisor" as "admin" | "supervisor",
  terminalId: "",
  departmentId: "",
};

export function UsersClient({
  users: initialUsers,
  terminals,
  departments,
  terminalMap,
  deptMap,
  currentUserId,
}: UsersClientProps) {
  const { toast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    user: UserRow;
    activate: boolean;
  } | null>(null);

  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    role: "supervisor" as "admin" | "supervisor",
    terminalId: "",
    departmentId: "",
  });
  const [newPwd, setNewPwd] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  function deptsByTerminal(terminalId: string) {
    return departments.filter((d) => d.terminalId === terminalId);
  }

  function openEdit(u: UserRow) {
    setEditTarget(u);
    setEditForm({
      name: u.name,
      email: u.email,
      role: u.role,
      terminalId: u.terminalId ?? "",
      departmentId: u.departmentId ?? "",
    });
    setDialogError(null);
  }

  function run(action: () => Promise<void>, onClose: () => void) {
    setDialogError(null);
    startTransition(async () => {
      try {
        await action();
        onClose();
        toast({ title: "Saved" });
      } catch (e) {
        setDialogError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage admin and supervisor accounts
          </p>
        </div>
        <Button
          onClick={() => {
            setCreateForm(emptyCreate);
            setDialogError(null);
            setCreateOpen(true);
          }}
        >
          <PlusCircle className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialUsers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-10"
                >
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              initialUsers.map((u) => (
                <TableRow
                  key={u.id}
                  className={!u.isActive ? "opacity-60 bg-slate-50" : undefined}
                >
                  <TableCell className="font-medium">
                    {u.name}
                    {u.id === currentUserId && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.email}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        u.role === "admin"
                          ? "bg-purple-100 text-purple-800 hover:bg-purple-100"
                          : "bg-blue-100 text-blue-800 hover:bg-blue-100"
                      }
                    >
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.role === "admin" ? (
                      <span className="italic">All terminals</span>
                    ) : u.terminalId ? (
                      <>
                        {terminalMap[u.terminalId] ?? "—"}
                        {u.departmentId && (
                          <span className="text-xs ml-1">
                            / {deptMap[u.departmentId]}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-600 text-xs">No scope set</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.createdAt}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        u.isActive
                          ? "bg-green-100 text-green-800 hover:bg-green-100"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-100"
                      }
                    >
                      {u.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Edit user"
                        onClick={() => openEdit(u)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Reset password"
                        onClick={() => {
                          setResetTarget(u);
                          setNewPwd("");
                          setDialogError(null);
                        }}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        title={u.isActive ? "Deactivate" : "Reactivate"}
                        disabled={u.id === currentUserId && u.isActive}
                        onClick={() =>
                          setStatusTarget({ user: u, activate: !u.isActive })
                        }
                      >
                        {u.isActive ? (
                          <UserX className="w-3.5 h-3.5 text-red-500" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5 text-green-600" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Create Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!o) setCreateOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Set initial password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={createForm.role}
                onValueChange={(v) =>
                  setCreateForm((f) => ({
                    ...f,
                    role: v as "admin" | "supervisor",
                    terminalId: "",
                    departmentId: "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createForm.role === "supervisor" && (
              <>
                <div className="space-y-1.5">
                  <Label>Terminal</Label>
                  <Select
                    value={createForm.terminalId}
                    onValueChange={(v) =>
                      setCreateForm((f) => ({
                        ...f,
                        terminalId: v,
                        departmentId: "",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select terminal" />
                    </SelectTrigger>
                    <SelectContent>
                      {terminals.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Department{" "}
                    <span className="text-muted-foreground text-xs">
                      (optional — blank = whole terminal)
                    </span>
                  </Label>
                  <Select
                    value={createForm.departmentId}
                    onValueChange={(v) =>
                      setCreateForm((f) => ({ ...f, departmentId: v }))
                    }
                    disabled={!createForm.terminalId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All departments" />
                    </SelectTrigger>
                    <SelectContent>
                      {deptsByTerminal(createForm.terminalId).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {dialogError && (
              <p className="text-sm text-destructive">{dialogError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    createUser({
                      name: createForm.name,
                      email: createForm.email,
                      password: createForm.password,
                      role: createForm.role,
                      terminalId: createForm.terminalId || null,
                      departmentId: createForm.departmentId || null,
                    } satisfies UserCreatePayload),
                  () => setCreateOpen(false)
                )
              }
            >
              {isPending ? "Saving…" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ───────────────────────────────────────────── */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(v) =>
                  setEditForm((f) => ({
                    ...f,
                    role: v as "admin" | "supervisor",
                    terminalId: "",
                    departmentId: "",
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supervisor">Supervisor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editForm.role === "supervisor" && (
              <>
                <div className="space-y-1.5">
                  <Label>Terminal</Label>
                  <Select
                    value={editForm.terminalId}
                    onValueChange={(v) =>
                      setEditForm((f) => ({
                        ...f,
                        terminalId: v,
                        departmentId: "",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select terminal" />
                    </SelectTrigger>
                    <SelectContent>
                      {terminals.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Department{" "}
                    <span className="text-muted-foreground text-xs">
                      (optional)
                    </span>
                  </Label>
                  <Select
                    value={editForm.departmentId}
                    onValueChange={(v) =>
                      setEditForm((f) => ({ ...f, departmentId: v }))
                    }
                    disabled={!editForm.terminalId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All departments" />
                    </SelectTrigger>
                    <SelectContent>
                      {deptsByTerminal(editForm.terminalId).map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {dialogError && (
              <p className="text-sm text-destructive">{dialogError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    editUser(editTarget!.id, {
                      name: editForm.name,
                      email: editForm.email,
                      role: editForm.role,
                      terminalId: editForm.terminalId || null,
                      departmentId: editForm.departmentId || null,
                    } satisfies UserEditPayload),
                  () => setEditTarget(null)
                )
              }
            >
              {isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ─────────────────────────────────── */}
      <Dialog
        open={!!resetTarget}
        onOpenChange={(o) => {
          if (!o) setResetTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password — {resetTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>New Password</Label>
              <Input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            {dialogError && (
              <p className="text-sm text-destructive">{dialogError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetTarget(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => resetPassword(resetTarget!.id, newPwd),
                  () => setResetTarget(null)
                )
              }
            >
              {isPending ? "Saving…" : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deactivate / Reactivate Confirm ──────────────────────── */}
      <AlertDialog
        open={!!statusTarget}
        onOpenChange={(o) => {
          if (!o) setStatusTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.activate ? "Reactivate" : "Deactivate"}{" "}
              {statusTarget?.user.name}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription className="px-0">
            {statusTarget?.activate
              ? "This user will be able to log in again."
              : "This user will no longer be able to log in."}
          </AlertDialogDescription>
          {dialogError && (
            <p className="text-sm text-destructive">{dialogError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={isPending}
              className={
                statusTarget?.activate
                  ? ""
                  : "bg-destructive hover:bg-destructive/90 text-white"
              }
              onClick={() => {
                if (!statusTarget) return;
                const { user, activate } = statusTarget;
                run(
                  () => setUserStatus(user.id, activate),
                  () => setStatusTarget(null)
                );
              }}
            >
              {isPending
                ? "Saving…"
                : statusTarget?.activate
                ? "Reactivate"
                : "Deactivate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
