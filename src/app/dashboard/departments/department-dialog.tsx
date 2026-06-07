"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { createDepartment, updateDepartment, deleteDepartment } from "./actions";
import { Pencil, Trash2, Plus } from "lucide-react";

interface Terminal {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
  terminalId: string;
}

export function DepartmentDialog({
  terminals,
  department,
  defaultTerminalId,
}: {
  terminals: Terminal[];
  department?: Department;
  defaultTerminalId?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(department?.name ?? "");
  const [terminalId, setTerminalId] = useState(
    department?.terminalId ?? defaultTerminalId ?? terminals[0]?.id ?? ""
  );
  const [pending, startTransition] = useTransition();

  function handleOpen() {
    setName(department?.name ?? "");
    setTerminalId(
      department?.terminalId ?? defaultTerminalId ?? terminals[0]?.id ?? ""
    );
    setOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (department) {
          await updateDepartment(department.id, name);
          toast({ title: "Department updated" });
        } else {
          await createDepartment(terminalId, name);
          toast({ title: "Department created" });
        }
        setOpen(false);
      } catch (err) {
        toast({
          title: "Error",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <>
      {department ? (
        <Button variant="ghost" size="icon" onClick={handleOpen}>
          <Pencil className="w-4 h-4" />
        </Button>
      ) : (
        <Button onClick={handleOpen} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Department
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {department ? "Edit Department" : "New Department"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!department && (
              <div className="space-y-2">
                <Label>Terminal</Label>
                <Select value={terminalId} onValueChange={setTerminalId}>
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
            )}

            <div className="space-y-2">
              <Label htmlFor="dept-name">Department Name</Label>
              <Input
                id="dept-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ticketing"
                required
                autoFocus
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteDepartmentButton({
  department,
}: {
  department: Department;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteDepartment(department.id);
        toast({ title: "Department deleted" });
      } catch (err) {
        toast({
          title: "Error",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" disabled={pending}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Department</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <strong>{department.name}</strong>? Workers assigned to this
            department will need to be reassigned. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
