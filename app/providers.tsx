"use client";

import { SessionProvider } from "next-auth/react";
import { AppViewProvider } from "@/lib/use-app-view";
import { NotificationsProvider } from "@/lib/use-notifications";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <NotificationsProvider>
        <AppViewProvider>{children}</AppViewProvider>
      </NotificationsProvider>
    </SessionProvider>
  );
}