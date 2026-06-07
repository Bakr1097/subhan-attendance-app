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
import { useToast } from "@/hooks/use-toast";
import { createTerminal, updateTerminal, deleteTerminal } from "./actions";
import { Pencil, Trash2, Plus } from "lucide-react";

interface Terminal {
  id: string;
  name: string;
}

// Add / Edit dialog
export function TerminalDialog({
  terminal,
  onClose,
}: {
  terminal?: Terminal;
  onClose?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(terminal?.name ?? "");
  const [pending, startTransition] = useTransition();

  function handleOpen() {
    setName(terminal?.name ?? "");
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    onClose?.();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        if (terminal) {
          await updateTerminal(terminal.id, name);
          toast({ title: "Terminal updated" });
        } else {
          await createTerminal(name);
          toast({ title: "Terminal created" });
        }
        handleClose();
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
      {terminal ? (
        <Button variant="ghost" size="icon" onClick={handleOpen}>
          <Pencil className="w-4 h-4" />
        </Button>
      ) : (
        <Button onClick={handleOpen} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Terminal
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {terminal ? "Edit Terminal" : "New Terminal"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="terminal-name">Terminal Name</Label>
              <Input
                id="terminal-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Subhan Bus Terminal"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
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

// Delete button with confirmation
export function DeleteTerminalButton({ terminal }: { terminal: Terminal }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTerminal(terminal.id);
        toast({ title: "Terminal deleted" });
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
          <AlertDialogTitle>Delete Terminal</AlertDialogTitle>
          <AlertDialogDescription>
            Delete <strong>{terminal.name}</strong>? This will also remove all
            departments, workers, and attendance data linked to it. This cannot
            be undone.
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
