import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/layout/AppShell";

export const viewport: Viewport = {
  themeColor: "#22c55e",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Football Opportunity Marketplace",
  description:
    "Connect football players with team opportunities. Find your next team or recruit the best talent.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}