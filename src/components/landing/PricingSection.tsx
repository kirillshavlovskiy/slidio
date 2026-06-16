"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import {
  PLANS,
  PLAN_ORDER,
  SHARED_FEATURES,
  approxEdits,
  formatTokens,
  tokensForPlan,
  type BillingInterval,
  type PlanId,
} from "@/lib/billing/plans";
import { startCheckout } from "@/lib/billing/client";
import { cn } from "@/lib/utils";

export function PricingSection() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const signedIn = status === "authenticated" && !!session?.user;
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planLimits, setPlanLimits] = useState<Record<PlanId, number> | null>(null);

  useEffect(() => {
    fetch("/api/billing/plans")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.limits) setPlanLimits(data.limits as Record<PlanId, number>);
      })
      .catch(() => {});
  }, []);

  const handleCta = async (planId: PlanId) => {
    setError(null);
    const plan = PLANS[planId];

    // Free plan: just send them into the app.
    if (!plan.paid) {
      router.push("/app");
      return;
    }

    // Must be signed in before we can create a Stripe customer / checkout.
    if (!signedIn) {
      router.push("/app");
      return;
    }

    setBusy(planId);
    try {
      await startCheckout(planId, interval);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(null);
    }
  };

  return (
    <section id="pricing" className="border-t border-[#11233b] bg-[#070c16] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            One product. Pick your token budget.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Every plan has the exact same features. The only difference is how many
            edit&nbsp;tokens you get each month — so you only pay for how much you edit.
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          <span
            className={cn(
              "text-sm font-medium",
              interval === "monthly" ? "text-white" : "text-slate-500"
            )}
          >
            Monthly
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={interval === "yearly"}
            onClick={() => setInterval((i) => (i === "monthly" ? "yearly" : "monthly"))}
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors",
              interval === "yearly" ? "bg-gradient-to-r from-violet-500 to-blue-500" : "bg-[#1e3a5f]"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
                interval === "yearly" ? "translate-x-5" : "translate-x-0.5"
              )}
            />
          </button>
          <span
            className={cn(
              "text-sm font-medium",
              interval === "yearly" ? "text-white" : "text-slate-500"
            )}
          >
            Yearly <span className="text-emerald-400">(2 months free)</span>
          </span>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-3">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            const monthlyTokens = tokensForPlan(planId, planLimits);
            const price = interval === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
            const priceLabel =
              plan.monthlyPrice === 0
                ? "$0"
                : interval === "yearly"
                  ? `$${Math.round(price / 12)}`
                  : `$${Number.isInteger(price) ? price : price.toFixed(2)}`;

            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col rounded-2xl border bg-[#0d1b2a] p-6 shadow-sm",
                  plan.highlighted
                    ? "border-violet-500/60 ring-1 ring-violet-500/40"
                    : "border-[#1e3a5f]"
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                  {plan.highlighted && (
                    <span className="rounded-full bg-gradient-to-r from-violet-500 to-blue-500 px-2.5 py-1 text-xs font-semibold text-white">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-400">{plan.tagline}</p>

                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-white">
                    {priceLabel}
                  </span>
                  {plan.monthlyPrice > 0 && <span className="text-sm text-slate-400">/mo</span>}
                </div>
                {plan.paid && interval === "yearly" && (
                  <p className="mt-1 text-xs text-slate-500">Billed ${plan.yearlyPrice}/year</p>
                )}

                <div className="mt-5 rounded-xl bg-[#0a0f1a] p-4">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    <span className="text-xl font-bold text-white">
                      {formatTokens(monthlyTokens)}
                    </span>
                    <span className="text-sm text-slate-400">tokens / month</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    ≈ {approxEdits(monthlyTokens).toLocaleString()} AI edits
                  </p>
                </div>

                <ul className="mt-6 space-y-3 text-sm">
                  {SHARED_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span className="text-slate-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => handleCta(plan.id)}
                    disabled={busy !== null}
                    className={cn(
                      "inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50",
                      plan.highlighted
                        ? "bg-gradient-to-r from-violet-500 to-blue-500 text-white"
                        : "border border-[#1e3a5f] text-slate-200 hover:bg-[#11233b]"
                    )}
                  >
                    {busy === plan.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : !plan.paid ? (
                      signedIn ? "Open workspace" : "Start free"
                    ) : !signedIn ? (
                      "Sign in to upgrade"
                    ) : (
                      `Get ${plan.name}`
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="mt-6 text-center text-sm text-red-400">{error}</p>}
        <p className="mt-6 text-center text-xs text-slate-500">
          A token is one unit of AI work (input + output) across a single edit. Simple
          element-level commands are cheap; deck-wide edits use more.
        </p>
      </div>
    </section>
  );
}
