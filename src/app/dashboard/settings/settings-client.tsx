"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { updatePayrollCutoffTime } from "./actions";

export function SettingsClient({
  payrollCutoffTime,
}: {
  payrollCutoffTime: string;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState(payrollCutoffTime);
  const [pending, startTransition] = useTransition();

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
              className="w-40"
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
    </div>
  );
}
