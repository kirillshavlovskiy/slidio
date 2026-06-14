"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";

export function HeroActions() {
  const { data: session, status } = useSession();
  const signedIn = status === "authenticated" && !!session?.user;

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
      <Link
        href="/app"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-opacity hover:opacity-90"
      >
        {signedIn ? "Open your workspace" : "Start free"}
        <ArrowRight className="ml-1 h-4 w-4" />
      </Link>
      <a
        href="#pricing"
        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1e3a5f] px-6 py-3 text-sm font-semibold text-slate-200 transition-colors hover:border-[#2a4a6f] hover:bg-[#0d1b2a]"
      >
        See pricing
      </a>
    </div>
  );
}
