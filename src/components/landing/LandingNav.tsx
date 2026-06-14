"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";

export function LandingNav() {
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && !!session?.user;

  return (
    <header className="sticky top-0 z-40 border-b border-[#11233b] bg-[#0a0f1a]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-white">Slidio</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
          <a href="#features" className="transition-colors hover:text-white">
            Features
          </a>
          <a href="#how" className="transition-colors hover:text-white">
            How it works
          </a>
          <a href="#pricing" className="transition-colors hover:text-white">
            Pricing
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {status === "loading" ? (
            <span className="text-xs text-slate-500">…</span>
          ) : signedIn ? (
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Open app
            </Link>
          ) : (
            <>
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
              >
                Sign in
              </Link>
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
