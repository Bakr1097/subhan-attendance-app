import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Attendance Kiosk",
  manifest: "/manifest.json",
};

export default function KioskLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden select-none">
      {children}
    </div>
  );
}
