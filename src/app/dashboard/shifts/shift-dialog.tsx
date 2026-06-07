"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { createShift, updateShift, deleteShift } from "./actions";
import { Pencil, Trash2, Plus } from "lucide-react";

interface Terminal {
  id: string;
  name: string;
}

interface Shift {
  id: string;
  terminalId: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  earlyLeaveGraceMinutes: number;
  crossesMidnight: boolean;
}

const DEFAULTS = {
  name: "",
  startTime: "08:00",
  endTime: "16:00",
  graceMinutes: 10,
  earlyLeaveGraceMinutes: 10,
  crossesMidnight: false,
};

export function ShiftDialog({
  terminals,
  shift,
  defaultTerminalId,
}: {
  terminals: Terminal[];
  shift?: Shift;
  defaultTerminalId?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const initial = shift
    ? {
        terminalId: shift.terminalId,
        name: shift.name,
        startTime: shift.startTime.slice(0, 5),
        endTime: shift.endTime.slice(0, 5),
        graceMinutes: shift.graceMinutes,
        earlyLeaveGraceMinutes: shift.earlyLeaveGraceMinutes,
        crossesMidnight: shift.crossesMidnight,
      }
    : {
        terminalId: defaultTerminalId ?? terminals[0]?.id ?? "",
        ...DEFAULTS,
      };

  const [form, setForm] = useState(initial);

  function handleOpen() {
    setForm(initial);
    setOpen(true);
  }

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (shift) {
          await updateShift(shift.id, form);
        } else {
          await createShift(form);
        }
        setOpen(false);
        toast({ title: shift ? "Shift updated" : "Shift created" });
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
      {shift ? (
        <Button variant="ghost" size="icon" onClick={handleOpen}>
          <Pencil className="w-4 h-4" />
        </Button>
      ) : (
        <Button onClick={handleOpen} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Shift
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{shift ? "Edit Shift" : "New Shift"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!shift && (
              <div className="space-y-2">
                <Label>Terminal</Label>
                <Select
                  value={form.terminalId}
                  onValueChange={(v) => set("terminalId", v)}
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
            )}

            <div className="space-y-2">
              <Label htmlFor="shift-name">Shift Name</Label>
              <Input
                id="shift-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Morning Shift"
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time</Label>
                <Input
                  id="start-time"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-time">End Time</Label>
                <Input
                  id="end-time"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="grace">Late grace (min)</Label>
                <Input
                  id="grace"
                  type="number"
                  min={0}
                  max={120}
                  value={form.graceMinutes}
                  onChange={(e) =>
                    set("graceMinutes", parseInt(e.target.value) || 0)
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="early-grace">Early-leave grace (min)</Label>
                <Input
                  id="early-grace"
                  type="number"
                  min={0}
                  max={120}
                  value={form.earlyLeaveGraceMinutes}
                  onChange={(e) =>
                    set(
                      "earlyLeaveGraceMinutes",
                      parseInt(e.target.value) || 0
                    )
                  }
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3 bg-slate-50">
              <div>
                <p className="text-sm font-medium">Crosses midnight</p>
                <p className="text-xs text-muted-foreground">
                  Turn on for night shifts that end the next day
                </p>
              </div>
              <Switch
                checked={form.crossesMidnight}
                onCheckedChange={(v) => set("crossesMidnight", v)}
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

export function DeleteShiftButton({ shift }: { shift: Shift }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteShift(shift.id);
        toast({ title: "Shift deleted" });
      } catch (err) {
        toast({
          title: "Cannot delete shift",
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
          <AlertDialogTitle>Delete Shift</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <strong>{shift.name}</strong>? Workers using this shift will
            lose their default schedule. This cannot be undone.
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
