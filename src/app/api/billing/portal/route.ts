import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe";

function appOrigin(request: NextRequest): string {
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
    return NextResponse.json({ error: "Sign in to manage billing." }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Billing is not configured. Set STRIPE_SECRET_KEY." },
      { status: 503 }
    );
  }

  const record = await prisma.user.findUnique({ where: { id: user.id } });
  if (!record?.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account yet. Upgrade to a paid plan first." },
      { status: 400 }
    );
  }

  try {
    const stripe = getStripe();
    let customerId = record.stripeCustomerId;
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if ("deleted" in existing && existing.deleted) throw new Error("deleted");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "resource_missing" || err instanceof Error && err.message === "deleted") {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            stripeCustomerId: null,
            subscriptionId: null,
            subscriptionStatus: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            plan: "free",
          },
        });
        return NextResponse.json(
          { error: "Billing account was reset after switching Stripe modes. Upgrade again." },
          { status: 400 }
        );
      }
      throw err;
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin(request)}/app`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    console.error("Portal error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not open billing portal." },
      { status: 500 }
    );
  }
}
