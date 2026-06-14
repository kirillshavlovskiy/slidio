export type PlanId = "free" | "pro" | "max";

export type BillingInterval = "monthly" | "yearly";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Monthly price in whole USD. `yearlyPrice` is the full annual charge. */
  monthlyPrice: number;
  yearlyPrice: number;
  /** The ONLY thing that differs between plans: included edit tokens per month. */
  monthlyTokens: number;
  highlighted?: boolean;
  /** Whether a paid Stripe subscription is required for this plan. */
  paid: boolean;
}

export const AVG_TOKENS_PER_EDIT = 7000;

/** Quotas are env-configurable so they can be tuned without a code deploy. */
function tokenQuota(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const FREE_TOKENS = tokenQuota("DECKPILOT_FREE_TOKENS", 200_000);
const PRO_TOKENS = tokenQuota("DECKPILOT_PRO_TOKENS", 2_000_000);
const MAX_TOKENS = tokenQuota("DECKPILOT_MAX_TOKENS", 5_000_000);

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Kick the tires on real decks.",
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyTokens: FREE_TOKENS,
    paid: false,
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For weekly deck work.",
    monthlyPrice: 0.02,
    yearlyPrice: 200,
    monthlyTokens: PRO_TOKENS,
    paid: true,
    highlighted: true,
  },
  max: {
    id: "max",
    name: "Max",
    tagline: "For heavy, daily editing.",
    monthlyPrice: 0.05,
    yearlyPrice: 500,
    monthlyTokens: MAX_TOKENS,
    paid: true,
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "max"];

/** Every plan ships the same capabilities — only the token budget changes. */
export const SHARED_FEATURES: string[] = [
  "Tap-to-select element editing",
  "2–5 word AI commands",
  "Review, apply, or reject each change",
  "Full version history & restore",
  "Persistent knowledge layers",
  "Export clean PPTX & PDF",
];

export function approxEdits(tokens: number): number {
  return Math.max(0, Math.round(tokens / AVG_TOKENS_PER_EDIT));
}

/** Human-friendly token count, e.g. 2_000_000 -> "2M". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return `${tokens}`;
}

/**
 * Stripe price ids are read from the environment so the same code works across
 * test/live modes without hardcoding ids.
 */
export function getPriceId(plan: PlanId, interval: BillingInterval): string | null {
  if (!PLANS[plan]?.paid) return null;
  const base = `STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`;
  return process.env[base] || null;
}

export function planForPriceId(priceId: string | null | undefined): PlanId {
  if (!priceId) return "free";
  for (const id of PLAN_ORDER) {
    if (!PLANS[id].paid) continue;
    if (
      priceId === process.env[`STRIPE_PRICE_${id.toUpperCase()}_MONTHLY`] ||
      priceId === process.env[`STRIPE_PRICE_${id.toUpperCase()}_YEARLY`]
    ) {
      return id;
    }
  }
  return "free";
}

export function tokenLimitForPlan(plan: PlanId | undefined | null): number {
  return PLANS[plan ?? "free"]?.monthlyTokens ?? PLANS.free.monthlyTokens;
}

export function isPaidPlan(plan: PlanId | undefined | null): boolean {
  return Boolean(plan && PLANS[plan]?.paid);
}
