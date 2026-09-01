"use client";

import { SessionProvider } from "next-auth/react";
import { AppViewProvider } from "@/lib/use-app-view";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppViewProvider>{children}</AppViewProvider>
    </SessionProvider>
  );
}
