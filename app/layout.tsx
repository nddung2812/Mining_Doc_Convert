import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MDocConvert — Mining Doc Factory",
  description:
    "AI-assisted drafting of client-branded mining compliance documents. Every document requires review by a qualified person.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight text-[#1F3A5F]">
              MDocConvert
              <span className="ml-2 text-sm font-normal text-slate-500">mining doc factory</span>
            </Link>
            <nav className="flex gap-6 text-sm font-medium text-slate-600">
              <Link href="/" className="hover:text-slate-900">New run</Link>
              <Link href="/runs" className="hover:text-slate-900">History</Link>
              <Link href="/clients" className="hover:text-slate-900">Clients</Link>
              <Link href="/settings" className="hover:text-slate-900">Settings</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-6 pb-8 text-xs text-slate-400">
          Drafting accelerator only — the qualified reviewer remains the author of record for every document.
        </footer>
      </body>
    </html>
  );
}
