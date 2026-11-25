"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  updatePayrollCutoffTime,
  updateMaxOpenShiftHours,
  updateKioskRefreshMinutes,
  updateMinShiftMinutes,
  updateMissingCheckoutHours,
} from "./actions";

export function SettingsClient({
  payrollCutoffTime,
  maxOpenShiftHours,
  kioskRefreshMinutes,
  minShiftMinutes,
  missingCheckoutHours,
}: {
  payrollCutoffTime: string;
  maxOpenShiftHours: number;
  kioskRefreshMinutes: number;
  minShiftMinutes: number;
  missingCheckoutHours: number;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(payrollCutoffTime);
  const [pending, startTransition] = useTransition();

  const [maxHoursValue, setMaxHoursValue] = useState(String(maxOpenShiftHours));
  const [maxHoursPending, startMaxHoursTransition] = useTransition();

  const [kioskRefreshValue, setKioskRefreshValue] = useState(String(kioskRefreshMinutes));
  const [kioskRefreshPending, startKioskRefreshTransition] = useTransition();

  const [minShiftValue, setMinShiftValue] = useState(String(minShiftMinutes));
  const [minShiftPending, startMinShiftTransition] = useTransition();

  const [missingHoursValue, setMissingHoursValue] = useState(String(missingCheckoutHours));
  const [missingHoursPending, startMissingHoursTransition] = useTransition();

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

  function handleSaveKioskRefresh() {
    startKioskRefreshTransition(async () => {
      try {
        await updateKioskRefreshMinutes(Number(kioskRefreshValue));
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

  function handleSaveMinShift() {
    startMinShiftTransition(async () => {
      try {
        await updateMinShiftMinutes(Number(minShiftValue));
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

  function handleSaveMissingHours() {
    startMissingHoursTransition(async () => {
      try {
        await updateMissingCheckoutHours(Number(missingHoursValue));
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

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Kiosk Worker List Refresh</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kiosk-refresh-minutes">Kiosk worker list refresh (minutes)</Label>
            <Input
              id="kiosk-refresh-minutes"
              type="number"
              min={5}
              max={240}
              step={1}
              value={kioskRefreshValue}
              onChange={(e) => setKioskRefreshValue(e.target.value)}
              className="w-full sm:w-40"
            />
            <p className="text-xs text-muted-foreground">
              How often the kiosk re-fetches its worker list from the server.
              A longer interval reduces database usage. Newly added workers or
              PIN changes may take up to this long to appear on the kiosk.
            </p>
          </div>
          <Button
            onClick={handleSaveKioskRefresh}
            disabled={kioskRefreshPending || !kioskRefreshValue}
          >
            {kioskRefreshPending ? (
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
          <CardTitle className="text-base">Minimum Shift Length</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="min-shift-minutes">Minimum shift length (minutes)</Label>
            <Input
              id="min-shift-minutes"
              type="number"
              min={0}
              max={240}
              step={1}
              value={minShiftValue}
              onChange={(e) => setMinShiftValue(e.target.value)}
              className="w-full sm:w-40"
            />
            <p className="text-xs text-muted-foreground">
              A punch this soon after an open check-in is ignored instead of
              counting as the check-out. Ignored punches are shown on the
              Attendance page so a genuine early departure can be corrected.
              0 turns this off.
            </p>
          </div>
          <Button
            onClick={handleSaveMinShift}
            disabled={minShiftPending || minShiftValue === ""}
          >
            {minShiftPending ? (
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
          <CardTitle className="text-base">Missing Checkout Warning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="missing-checkout-hours">Warn after (hours since check-in)</Label>
            <Input
              id="missing-checkout-hours"
              type="number"
              min={1}
              max={24}
              step={1}
              value={missingHoursValue}
              onChange={(e) => setMissingHoursValue(e.target.value)}
              className="w-full sm:w-40"
            />
            <p className="text-xs text-muted-foreground">
              An open check-in shows as &quot;Missing checkout&quot; on the
              Attendance page and Dashboard once it has been open this long.
              This is only a warning — a check-out still closes the shift up
              to the Maximum Open Shift limit.
            </p>
          </div>
          <Button
            onClick={handleSaveMissingHours}
            disabled={missingHoursPending || !missingHoursValue}
          >
            {missingHoursPending ? (
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
