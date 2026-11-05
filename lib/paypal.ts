// PayPal REST adapter (sandbox only). Credentials stay server-side.
// When PAYPAL_CLIENT_ID/SECRET are not configured, a clearly-labelled local simulator is used instead;
// the UI then shows "PayPal simulator" rather than "PayPal sandbox" so nothing is passed off as real.
import crypto from "node:crypto";

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? "";
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID ?? "";

export type PayPalMode = "sandbox" | "simulator";
// PEAKSHIFT_PAYPAL=simulator forces the labelled simulator even when sandbox keys are present (local testing).
export const paypalMode = (): PayPalMode => (process.env.PEAKSHIFT_PAYPAL !== "simulator" && CLIENT_ID && CLIENT_SECRET ? "sandbox" : "simulator");
export const paypalPublicClientId = () => (paypalMode() === "sandbox" ? CLIENT_ID : null);
export const webhookConfigured = () => Boolean(WEBHOOK_ID);

let token: { value: string; exp: number } | null = null;

export class PayPalError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
    public detail?: unknown,
  ) {
    super(message);
  }
}

async function accessToken(force = false) {
  if (!force && token && token.exp > Date.now() + 60_000) return token.value;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new PayPalError("OAUTH_FAILED", "Payments connection needs attention.", res.status);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function call<T>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}, retried = false): Promise<T> {
  const t = await accessToken();
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401 && !retried) {
    await accessToken(true);
    return call<T>(method, p, body, headers, true);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new PayPalError(json?.name ?? `HTTP_${res.status}`, json?.message ?? `PayPal returned ${res.status}`, res.status, redact(json));
  }
  return json as T;
}

export async function healthCheck(): Promise<{ ok: boolean; mode: PayPalMode; detail: string }> {
  if (paypalMode() === "simulator") return { ok: true, mode: "simulator", detail: "No PayPal credentials configured — using local simulator." };
  try {
    await accessToken(true);
    return { ok: true, mode: "sandbox", detail: "OAuth token acquired from PayPal sandbox." };
  } catch (e) {
    return { ok: false, mode: "sandbox", detail: (e as Error).message };
  }
}

// ---------- Checkout (Orders v2) ----------

export async function createOrder(args: { eventId: string; amountMinor: number; currency: string; description: string; requestId: string }) {
  if (paypalMode() === "simulator") return { id: "SIM-ORDER-" + crypto.randomBytes(5).toString("hex").toUpperCase(), status: "CREATED" };
  return call<{ id: string; status: string }>(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.eventId,
          custom_id: args.eventId,
          description: args.description.slice(0, 127),
          amount: { currency_code: args.currency, value: (args.amountMinor / 100).toFixed(2) },
        },
      ],
    },
    { "PayPal-Request-Id": args.requestId },
  );
}

export interface CaptureResult {
  status: string;
  captureId: string | null;
  amountMinor: number;
  currency: string;
  customId: string | null;
  raw: unknown;
}

export async function captureOrder(orderId: string, expect: { amountMinor: number; currency: string; eventId: string }): Promise<CaptureResult> {
  if (paypalMode() === "simulator") {
    return { status: "COMPLETED", captureId: "SIM-CAPTURE-" + crypto.randomBytes(5).toString("hex").toUpperCase(), amountMinor: expect.amountMinor, currency: expect.currency, customId: expect.eventId, raw: { simulated: true } };
  }
  type Cap = { status: string; purchase_units: { payments?: { captures?: { id: string; status: string; amount: { value: string; currency_code: string }; custom_id?: string }[] } }[] };
  const j = await call<Cap>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { "PayPal-Request-Id": `cap-${orderId}` });
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: cap?.status ?? j.status,
    captureId: cap?.id ?? null,
    amountMinor: cap ? Math.round(Number(cap.amount.value) * 100) : 0,
    currency: cap?.amount.currency_code ?? "",
    customId: cap?.custom_id ?? null,
    raw: redact(j),
  };
}

// ---------- Payouts ----------

export interface PayoutRequestItem {
  senderItemId: string;
  receiver: string;
  amountMinor: number;
  currency: string;
  note: string;
}

export async function createPayoutBatch(args: { senderBatchId: string; subject: string; message: string; items: PayoutRequestItem[] }) {
  type R = { batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header: { sender_batch_id: string } } };
  const j = await call<R>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: args.senderBatchId, email_subject: args.subject, email_message: args.message },
    items: args.items.map((i) => ({
      recipient_type: "EMAIL",
      receiver: i.receiver,
      amount: { value: (i.amountMinor / 100).toFixed(2), currency: i.currency },
      note: i.note,
      sender_item_id: i.senderItemId,
    })),
  });
  return { payoutBatchId: j.batch_header.payout_batch_id, batchStatus: j.batch_header.batch_status, raw: redact(j) };
}

export interface BatchDetail {
  batchStatus: string;
  items: { payoutItemId: string; senderItemId: string; transactionStatus: string; transactionId: string | null; error: string | null }[];
  raw: unknown;
}

export async function getPayoutBatch(payoutBatchId: string): Promise<BatchDetail> {
  type R = {
    batch_header: { batch_status: string };
    items: { payout_item_id: string; transaction_id?: string; transaction_status: string; payout_item: { sender_item_id: string }; errors?: { name: string; message: string } }[];
  };
  const j = await call<R>("GET", `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}?fields=batch_header,items&page_size=100`);
  return {
    batchStatus: j.batch_header.batch_status,
    items: (j.items ?? []).map((i) => ({
      payoutItemId: i.payout_item_id,
      senderItemId: i.payout_item.sender_item_id,
      transactionStatus: i.transaction_status,
      transactionId: i.transaction_id ?? null,
      error: i.errors ? `${i.errors.name}: ${i.errors.message}` : null,
    })),
    raw: redact(j),
  };
}

// ---------- Webhooks ----------

export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  if (paypalMode() === "simulator" || !WEBHOOK_ID) return false;
  const h = (k: string) => headers.get(k) ?? "";
  try {
    const j = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody),
    });
    return j.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/** Strip emails, names and links from PayPal payloads before storing or showing them. */
export function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/email|receiver|payer|name|address|phone/i.test(k)) out[k] = "[redacted]";
      else if (k === "links") out[k] = "[omitted]";
      else out[k] = redact(val);
    }
    return out;
  }
  return v;
}
