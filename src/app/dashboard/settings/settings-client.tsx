"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { updatePayrollCutoffTime, updateMaxOpenShiftHours } from "./actions";

export function SettingsClient({
  payrollCutoffTime,
  maxOpenShiftHours,
}: {
  payrollCutoffTime: string;
  maxOpenShiftHours: number;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(payrollCutoffTime);
  const [pending, startTransition] = useTransition();

  const [maxHoursValue, setMaxHoursValue] = useState(String(maxOpenShiftHours));
  const [maxHoursPending, startMaxHoursTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      try {
        await updatePayrollCutoffTime(value);
        toast({ title: "Settings saved" });
      } catch (err) {
        toast({
          title: "Error",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    });
  }

  function handleSaveMaxHours() {
    startMaxHoursTransition(async () => {
      try {
        await updateMaxOpenShiftHours(Number(maxHoursValue));
        toast({ title: "Settings saved" });
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Global settings for the attendance system
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Payroll Closing Time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cutoff-time">Daily closing time</Label>
            <Input
              id="cutoff-time"
              type="time"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full sm:w-40"
            />
            <p className="text-xs text-muted-foreground">
              Daily closing time. Payroll for a date covers the window from
              the previous day&apos;s cutoff to this date&apos;s cutoff.
            </p>
          </div>
          <Button onClick={handleSave} disabled={pending || !value}>
            {pending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Maximum Open Shift</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="max-open-shift-hours">Maximum open shift (hours)</Label>
            <Input
              id="max-open-shift-hours"
              type="number"
              min={1}
              max={24}
              step={1}
              value={maxHoursValue}
              onChange={(e) => setMaxHoursValue(e.target.value)}
              className="w-full sm:w-40"
            />
            <p className="text-xs text-muted-foreground">
              Any punch arriving more than this many hours after an unclosed
              check-in is treated as a new check-in, and the old record stays
              flagged for manual correction.
            </p>
          </div>
          <Button
            onClick={handleSaveMaxHours}
            disabled={maxHoursPending || !maxHoursValue}
          >
            {maxHoursPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
