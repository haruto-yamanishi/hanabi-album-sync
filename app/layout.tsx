import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hanabi Album-Sync", description: "Slack × Drive media archive for Team Hanabi" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
