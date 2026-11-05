// Server-only: resolves the PayPal sandbox payout recipient for a business.
// PAYPAL_SANDBOX_RECIPIENTS lets the demo pay real sandbox personal accounts, either as
//   "org_cleartank=a@x.com,org_freshfold=b@x.com,org_riverside=c@x.com"
// or as a plain list "a@x.com,b@x.com,c@x.com" assigned in dispatch order:
// ClearTank, FreshFold, Riverside, Harbour View, Glow Studio. Unset → the seeded demo addresses.
import type { Organisation } from "./types";

const ORDER = ["org_cleartank", "org_freshfold", "org_riverside", "org_harbour", "org_glow"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parse(): Map<string, string> {
  const raw = (process.env.PAYPAL_SANDBOX_RECIPIENTS ?? "").trim();
  const map = new Map<string, string>();
  if (!raw) return map;
  raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .forEach((entry, i) => {
      const [k, v] = entry.includes("=") ? entry.split("=").map((x) => x.trim()) : [ORDER[i], entry];
      if (k && v && EMAIL.test(v)) map.set(k, v);
    });
  return map;
}

export function recipientFor(org: Pick<Organisation, "id" | "payoutEmail">): string | undefined {
  return parse().get(org.id) ?? org.payoutEmail;
}

/** True when a configured sandbox account (not a seeded placeholder) will receive this payout. */
export function hasConfiguredRecipient(orgId: string) {
  return parse().has(orgId);
}
