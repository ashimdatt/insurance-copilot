import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Insurance Co-Pilot",
  description:
    "Roadside assistance intake, coverage check, and dispatch recommendation with human approval",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        <header className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] backdrop-blur-md sticky top-0 z-20">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tracking-tight">
                Insurance Co-Pilot
              </span>
              <span className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                Roadside
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[var(--muted)]">
              <Link className="hover:text-[var(--text)]" href="/voice">
                Voice intake
              </Link>
              <Link className="hover:text-[var(--text)]" href="/dashboard">
                Agent dashboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
