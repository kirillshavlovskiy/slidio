#!/usr/bin/env node
/**
 * Lists every registration (User row) with its plan + signup time.
 *
 * Local dev DB:
 *   node scripts/list-users.mjs
 * Production (Turso):
 *   DATABASE_URL=libsql://<db>.turso.io DATABASE_AUTH_TOKEN=... node scripts/list-users.mjs
 */
import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL || "file:./prisma/dev.db";
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;
const client = createClient({ url, authToken });

const { rows } = await client.execute(
  `SELECT email, name, plan, subscriptionStatus, createdAt
   FROM User ORDER BY createdAt DESC`
);

if (rows.length === 0) {
  console.log("No registrations yet.");
} else {
  console.table(
    rows.map((r) => ({
      email: r.email,
      name: r.name,
      plan: r.plan,
      status: r.subscriptionStatus ?? "",
      registered: r.createdAt,
    }))
  );
  const free = rows.filter((r) => r.plan === "free").length;
  console.log(`\nTotal: ${rows.length}  |  free: ${free}  |  paid: ${rows.length - free}`);
}
