import "server-only";
import Stripe from "stripe";

let cached: Stripe | null = null;

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Returns a shared Stripe client. Throws if the secret key is missing so callers
 * can surface a clear setup error instead of a cryptic runtime failure.
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  if (!cached) {
    cached = new Stripe(key, { appInfo: { name: "DeckPilot" } });
  }
  return cached;
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET.");
  }
  return secret;
}
