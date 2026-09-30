import type { Metadata } from "next";
import { Figtree, Fraunces } from "next/font/google";
import { AppProviders } from "@/components/app-providers";
import { PageMarks } from "@/components/page-marks";
import "./globals.css";

const sans = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "VDF",
  description: "Find duplicate videos in local files or an Immich library.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} dark`}>
      <body className="relative isolate min-h-screen antialiased">
        <PageMarks />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
