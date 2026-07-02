import type { Metadata } from "next";
import { LocalModeBanner } from "@/components/LocalModeBanner";
import { BRANDING } from "@/lib/branding";
import { AppProviders } from "@/providers/AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: BRANDING.appName,
  description: BRANDING.description,
  icons: {
    icon: BRANDING.logo.favicon,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/*
        App shell: a fixed-height flex column so the LocalModeBanner takes its
        natural height and the page content fills the rest. Without this the
        banner is a normal block stacked ABOVE a 100vh chat page, pushing the
        chat input below the fold (you had to scroll to reach it in LOCAL_MODE).
        Pages scroll inside the flex-1 region instead of the document.
      */}
      <body className="font-sans bg-background text-foreground antialiased flex h-screen flex-col overflow-hidden">
        <LocalModeBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AppProviders>{children}</AppProviders>
        </div>
      </body>
    </html>
  );
}
