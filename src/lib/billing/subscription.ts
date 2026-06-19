import "server-only";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { getStripe } from "./stripe";
import { planForPriceId, type PlanId } from "./plans";

export interface BillingState {
  plan: PlanId;
  status: string | null;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
}

export interface BillingUsageState {
  tokensUsed: number;
  tokenLimit: number;
  tokensRemaining: number;
  periodKey: string;
}

export type BillingStateResponse = BillingState & { usage: BillingUsageState };

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function resolvePlan(user: {
  plan?: string | null;
  subscriptionStatus?: string | null;
}): PlanId {
  const plan = (user.plan as PlanId) || "free";
  if (plan === "free") return "free";
  // Only honor a paid plan while the subscription is in a usable state.
  if (user.subscriptionStatus && ACTIVE_STATUSES.has(user.subscriptionStatus)) {
    return plan;
  }
  return "free";
}

export async function getBillingState(userId: string): Promise<BillingState> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const plan = user ? resolvePlan(user) : "free";
  return {
    plan,
    status: user?.subscriptionStatus ?? null,
    currentPeriodEnd: user?.currentPeriodEnd ? user.currentPeriodEnd.toISOString() : null,
    hasStripeCustomer: Boolean(user?.stripeCustomerId),
  };
}

/**
 * Returns the Stripe customer id for a user, creating the customer on first use.
 * If the stored id is missing in the current Stripe mode (e.g. live customer id
 * after switching to sk_test_), clears stale billing fields and creates a new one.
 */
export async function ensureStripeCustomer(user: {
  id: string;
  email?: string | null;
  name?: string | null;
}): Promise<string> {
  const record = await prisma.user.findUnique({ where: { id: user.id } });
  const stripe = getStripe();

  if (record?.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(record.stripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) {
        return record.stripeCustomerId;
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "resource_missing") throw err;
    }
  }

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customer.id,
      // Drop subscription state tied to the old (often live-mode) customer.
      subscriptionId: null,
      subscriptionStatus: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      plan: "free",
    },
  });
  return customer.id;
}

/**
 * Syncs the local user record from a Stripe subscription object. Used by the webhook.
 */
export async function syncSubscriptionToUser(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
  });
  if (!user) return;

  const item = subscription.items.data[0];
  const priceId = item?.price?.id;
  const plan = planForPriceId(priceId);

  // `current_period_*` live on the subscription item in recent API versions,
  // and on the subscription itself in older ones — read whichever is present.
  const periodEndUnix =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (subscription as unknown as { current_period_end?: number })?.current_period_end;
  const periodStartUnix =
    (item as unknown as { current_period_start?: number })?.current_period_start ??
    (subscription as unknown as { current_period_start?: number })?.current_period_start;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000) : null;
  const periodStart = periodStartUnix ? new Date(periodStartUnix * 1000) : null;

  const canceled =
    subscription.status === "canceled" ||
    subscription.status === "incomplete_expired";

  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan: canceled ? "free" : plan,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
}
