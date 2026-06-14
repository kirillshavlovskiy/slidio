import "server-only";
import { prisma } from "@/lib/prisma";
import { resolvePlan } from "./subscription";
import { tokenLimitForPlan, type PlanId } from "./plans";

export interface UsageState {
  plan: PlanId;
  tokenLimit: number;
  tokensUsed: number;
  tokensRemaining: number;
  periodKey: string;
}

/** 402 Payment Required — the user has exhausted this period's token allowance. */
export class QuotaExceededError extends Error {
  status = 402;
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

type PeriodUser = {
  plan?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodStart?: Date | null;
};

/**
 * The bucket key usage is counted against. For an active paid subscription this
 * is the Stripe billing-cycle start, so usage resets automatically on renewal
 * (the webhook advances `currentPeriodStart`). Free users reset by calendar month.
 */
export function periodKeyForUser(user: PeriodUser | null): string {
  const plan = user ? resolvePlan(user) : "free";
  if (plan !== "free" && user?.currentPeriodStart) {
    return `cycle:${user.currentPeriodStart.toISOString()}`;
  }
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `month:${month}`;
}

export async function getUsageState(userId: string): Promise<UsageState> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const plan = user ? resolvePlan(user) : "free";
  const tokenLimit = tokenLimitForPlan(plan);
  const periodKey = periodKeyForUser(user);

  const record = await prisma.usageRecord.findUnique({
    where: { userId_periodKey: { userId, periodKey } },
  });
  const tokensUsed = record?.tokensUsed ?? 0;

  return {
    plan,
    tokenLimit,
    tokensUsed,
    tokensRemaining: Math.max(0, tokenLimit - tokensUsed),
    periodKey,
  };
}

/**
 * Throws {@link QuotaExceededError} if the user has already consumed their
 * allowance for the current period. Call before starting a (costly) edit.
 */
export async function assertWithinQuota(userId: string): Promise<void> {
  const usage = await getUsageState(userId);
  if (usage.tokensRemaining <= 0) {
    throw new QuotaExceededError(
      "You've used all your edit tokens for this billing period. Upgrade your plan from the pricing page to keep editing, or wait for your next cycle to reset."
    );
  }
}

/** Adds consumed tokens to the user's current-period usage bucket. */
export async function recordTokenUsage(userId: string, tokens: number): Promise<void> {
  if (!userId || !tokens || tokens <= 0) return;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const periodKey = periodKeyForUser(user);
  await prisma.usageRecord.upsert({
    where: { userId_periodKey: { userId, periodKey } },
    create: { userId, periodKey, tokensUsed: tokens },
    update: { tokensUsed: { increment: tokens } },
  });
}

/** input + output tokens from an Anthropic usage object (cache reads not billed). */
export function usageTokens(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined
): number {
  return (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
}
