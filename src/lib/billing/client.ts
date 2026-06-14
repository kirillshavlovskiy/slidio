"use client";

import type { BillingInterval, PlanId } from "./plans";

async function postJson(url: string, body?: unknown): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data.url as string;
}

export async function startCheckout(
  plan: PlanId = "pro",
  interval: BillingInterval = "monthly"
) {
  const url = await postJson("/api/billing/checkout", { plan, interval });
  window.location.href = url;
}

export async function openBillingPortal() {
  const url = await postJson("/api/billing/portal");
  window.location.href = url;
}
