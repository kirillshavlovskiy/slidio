#!/usr/bin/env node
/**
 * Creates the Slidio products + recurring prices in your Stripe account and
 * prints the env lines to paste into .env.local.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe.mjs
 *
 * Use a TEST-mode key (sk_test_...) unless you really want live prices.
 * Re-running creates NEW prices each time, so only run it once per mode.
 */
import Stripe from "stripe";
import { readFileSync, existsSync } from "node:fs";

function loadEnvLocal() {
  const path = ".env.local";
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] != null) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnvLocal();

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Missing STRIPE_SECRET_KEY. Run:\n  STRIPE_SECRET_KEY=sk_test_xxx node scripts/setup-stripe.mjs");
  process.exit(1);
}

const stripe = new Stripe(key);

// Prices are in cents. Keep these in sync with src/lib/billing/plans.ts.
// NOTE: Stripe rejects charges below its per-currency minimum (~50¢ USD), so the
// monthly amounts must be >= 50. These are low TEST amounts; raise to real prices
// (e.g. monthly: 2000 / 5000) before going live.
const PLANS = [
  { id: "pro", name: "Slidio Pro", monthly: 50, yearly: 20000 },
  { id: "max", name: "Slidio Max", monthly: 100, yearly: 50000 },
];

const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";
console.error(`Creating products/prices in ${mode} mode...\n`);

const envLines = [];

for (const plan of PLANS) {
  const product = await stripe.products.create({
    name: plan.name,
    metadata: { plan: plan.id },
  });

  const monthly = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: plan.monthly,
    recurring: { interval: "month" },
  });

  const yearly = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: plan.yearly,
    recurring: { interval: "year" },
  });

  envLines.push(`STRIPE_PRICE_${plan.id.toUpperCase()}_MONTHLY="${monthly.id}"`);
  envLines.push(`STRIPE_PRICE_${plan.id.toUpperCase()}_YEARLY="${yearly.id}"`);
}

console.log("\n# Paste these into .env.local:\n");
console.log(envLines.join("\n"));
console.log("");
