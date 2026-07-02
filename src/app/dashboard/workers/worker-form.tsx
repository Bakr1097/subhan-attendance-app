"use client";

import { useState, useTransition, useRef } from "react";
import Image from "next/image";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { createWorker, updateWorker, type WorkerCreatePayload } from "./actions";
import { Plus, Pencil, Camera, X, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Terminal  { id: string; name: string }
interface Department { id: string; name: string; terminalId: string }
interface Shift      { id: string; name: string; terminalId: string }

interface WorkerRow {
  id: string;
  terminalId: string;
  departmentId: string;
  defaultShiftId: string | null;
  fullName: string;
  cnic: string | null;
  phone: string | null;
  referencePhotoUrl: string | null;
  deviceUserId: string | null;
}

interface Props {
  terminals: Terminal[];
  departments: Department[];
  allShifts: Shift[];
  worker?: WorkerRow;
  defaultTerminalId?: string;
}

// ─── Client-side image compression ───────────────────────────────────────────

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const MAX = 400;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) {
            height = Math.round((height * MAX) / width);
            width = MAX;
          } else {
            width = Math.round((width * MAX) / height);
            height = MAX;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) =>
            resolve(
              blob
                ? new File([blob], "photo.jpg", { type: "image/jpeg" })
                : file
            ),
          "image/jpeg",
          0.82
        );
      };
      img.src = ev.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkerForm({
  terminals,
  departments,
  allShifts,
  worker,
  defaultTerminalId,
}: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const initialTerminalId =
    worker?.terminalId ?? defaultTerminalId ?? terminals[0]?.id ?? "";

  function makeInitial() {
    return {
      terminalId: initialTerminalId,
      departmentId: worker?.departmentId ?? "",
      defaultShiftId: worker?.defaultShiftId ?? "",
      fullName: worker?.fullName ?? "",
      cnic: worker?.cnic ?? "",
      phone: worker?.phone ?? "",
      pin: "",
      referencePhotoUrl: worker?.referencePhotoUrl ?? "",
      deviceUserId: worker?.deviceUserId ?? "",
    };
  }

  const [form, setForm] = useState(makeInitial);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function handleOpen() {
    setForm(makeInitial());
    setOpen(true);
  }

  // Filtered selectors based on chosen terminal
  const filteredDepts = departments.filter(
    (d) => d.terminalId === form.terminalId
  );
  const filteredShifts = allShifts.filter(
    (s) => s.terminalId === form.terminalId
  );

  // When terminal changes reset department + shift
  function handleTerminalChange(val: string) {
    setForm((p) => ({
      ...p,
      terminalId: val,
      departmentId: "",
      defaultShiftId: "",
    }));
  }

  // ── Photo upload ────────────────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("file", compressed);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = (await res.json()) as { url: string };
      set("referencePhotoUrl", url);
      toast({ title: "Photo uploaded" });
    } catch {
      toast({
        title: "Photo upload failed",
        description: "Check your R2 credentials and bucket CORS settings.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload: WorkerCreatePayload = {
          terminalId: form.terminalId,
          departmentId: form.departmentId,
          defaultShiftId: form.defaultShiftId,
          fullName: form.fullName,
          pin: form.pin,
          cnic: form.cnic,
          phone: form.phone,
          referencePhotoUrl: form.referencePhotoUrl,
          deviceUserId: form.deviceUserId,
        };

        if (worker) {
          await updateWorker(worker.id, payload);
        } else {
          await createWorker(payload);
        }
        setOpen(false);
        toast({ title: worker ? "Worker updated" : "Worker added" });
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
      {worker ? (
        <Button variant="ghost" size="icon" onClick={handleOpen}>
          <Pencil className="w-4 h-4" />
        </Button>
      ) : (
        <Button onClick={handleOpen} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Worker
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{worker ? "Edit Worker" : "Add Worker"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pb-2">
            {/* Terminal — hidden if only one terminal or editing */}
            {!worker && terminals.length > 1 && (
              <div className="space-y-2">
                <Label>Terminal</Label>
                <Select
                  value={form.terminalId}
                  onValueChange={handleTerminalChange}
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

            {/* Department */}
            <div className="space-y-2">
              <Label>Department</Label>
              <Select
                value={form.departmentId}
                onValueChange={(v) => set("departmentId", v)}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {filteredDepts.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No departments for this terminal
                    </SelectItem>
                  ) : (
                    filteredDepts.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Default shift */}
            <div className="space-y-2">
              <Label>
                Default Shift{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Select
                value={form.defaultShiftId || "__none__"}
                onValueChange={(v) =>
                  set("defaultShiftId", v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No default shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No default shift —</SelectItem>
                  {filteredShifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Full name */}
            <div className="space-y-2">
              <Label htmlFor="w-name">Full Name</Label>
              <Input
                id="w-name"
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="e.g. Muhammad Ali"
                required
              />
            </div>

            {/* PIN */}
            <div className="space-y-2">
              <Label htmlFor="w-pin">
                4-Digit Kiosk PIN
                {worker && (
                  <span className="text-muted-foreground font-normal ml-1">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <Input
                id="w-pin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={form.pin}
                onChange={(e) =>
                  set("pin", e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="••••"
                required={!worker}
              />
            </div>

            {/* CNIC + Phone side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="w-cnic">
                  CNIC{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="w-cnic"
                  value={form.cnic}
                  onChange={(e) => set("cnic", e.target.value)}
                  placeholder="35202-1234567-1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="w-phone">
                  Phone{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="w-phone"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="03XX-XXXXXXX"
                />
              </div>
            </div>

            {/* Reference photo */}
            <div className="space-y-2">
              <Label>
                Reference Photo{" "}
                <span className="text-muted-foreground font-normal">
                  (optional — compressed to ~80 KB before upload)
                </span>
              </Label>
              <div className="flex items-center gap-3">
                {form.referencePhotoUrl ? (
                  <div className="relative w-16 h-16 rounded-md overflow-hidden border shrink-0">
                    <Image
                      src={form.referencePhotoUrl}
                      alt="Reference photo"
                      fill
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => set("referencePhotoUrl", "")}
                      className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-md border border-dashed flex items-center justify-center bg-slate-50 shrink-0">
                    <Camera className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="gap-2"
                  >
                    {uploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                    {uploading
                      ? "Uploading…"
                      : form.referencePhotoUrl
                        ? "Retake photo"
                        : "Take photo"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    Opens camera on tablet · file picker on desktop
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            {/* Biometric device user ID */}
            <div className="space-y-2">
              <Label htmlFor="w-device-user-id">
                Biometric Device User ID{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="w-device-user-id"
                value={form.deviceUserId}
                onChange={(e) => set("deviceUserId", e.target.value)}
                placeholder="e.g. 42"
              />
              <p className="text-xs text-muted-foreground">
                The User ID this worker is enrolled under on the attendance
                terminal. Leave blank if not using biometric device.
              </p>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || uploading}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Status toggle button ─────────────────────────────────────────────────────

import { setWorkerStatus } from "./actions";

export function WorkerStatusToggle({
  id,
  status,
}: {
  id: string;
  status: "active" | "inactive";
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = status === "active" ? "inactive" : "active";
    startTransition(async () => {
      try {
        await setWorkerStatus(id, next);
        toast({
          title: next === "inactive" ? "Worker deactivated" : "Worker reactivated",
        });
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
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={handleToggle}
      className={
        status === "active"
          ? "text-muted-foreground hover:text-destructive"
          : "text-muted-foreground hover:text-green-600"
      }
    >
      {status === "active" ? "Deactivate" : "Activate"}
    </Button>
  );
}
