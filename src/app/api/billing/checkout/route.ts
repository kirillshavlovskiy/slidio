import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe";
import { ensureStripeCustomer } from "@/lib/billing/subscription";
import { getPriceId, isPaidPlan, type BillingInterval, type PlanId } from "@/lib/billing/plans";

function appOrigin(request: NextRequest): string {
  // Prefer the actual request origin (correct dev port / deployed host); fall
  // back to the configured canonical URL only if it can't be derived.
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured. Set STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    interval?: BillingInterval;
    plan?: PlanId;
  };
  const interval: BillingInterval = body.interval === "yearly" ? "yearly" : "monthly";
  const plan: PlanId = body.plan && isPaidPlan(body.plan) ? body.plan : "pro";
  const priceId = getPriceId(plan, interval);

  if (!priceId) {
    return NextResponse.json(
      {
        error: `Missing price id. Set STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()} in .env.local.`,
      },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer({
      id: user.id,
      email: user.email,
      name: user.name,
    });
    const origin = appOrigin(request);

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/app?checkout=success`,
      cancel_url: `${origin}/?checkout=cancelled#pricing`,
      subscription_data: { metadata: { userId: user.id } },
      metadata: { userId: user.id },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    console.error("Checkout error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start checkout." },
      { status: 500 }
    );
  }
}
