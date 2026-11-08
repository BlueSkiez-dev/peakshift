# Devpost submission — PeakShift (draft to paste)

**Tagline:** AI-coordinated demand flexibility with verified PayPal incentive payouts.

**Links**
- Live demo: https://peakshift-seven.vercel.app (start at `/demo`)
- Code: https://github.com/BlueSkiez-dev/peakshift
- Video: _add the YouTube link_

**Built with:** PayPal Orders v2 (Checkout), PayPal Payouts, PayPal Webhooks (signature verification), Claude (Anthropic API), AG Grid, AG Charts, AG Studio (Agent Framework), Next.js, React, TypeScript, Tailwind CSS, PostgreSQL (Supabase), Vercel

---

## Inspiration

Evening peaks push local feeders past their ratings. In Lagos and many growing cities, the usual answer is load-shedding or diesel. Yet bakeries, laundries, water pumps and salons all run energy-heavy tasks that could happen a few hours earlier. Flexibility programmes exist for large industrial sites. Small businesses are left out: it is too costly to sign them up, too hard to check what they actually shifted, and too slow and manual to pay them small amounts.

## What it does

PeakShift lets a grid or programme operator turn many small businesses' flexibility into a resource it can **coordinate, verify and pay**.

1. **Fund:** the operator creates a peak event and pays the reward budget with **PayPal Checkout** (Orders v2). The server captures the order and checks the amount, currency and reference before the event counts as funded. The budget is a payment into the operator's own PayPal account, not escrow.
2. **Profile:** business owners describe what they can move in plain words, e.g. *"we can run the dough mixer between noon and 5 p.m., about 6 kWh, 60 cents per kWh"*. **Claude** turns that into a structured activity with its source evidence, marks missing fields, and never invents capacity. Refrigeration is always flagged as critical. The owner confirms before anything becomes eligible.
3. **Plan:** a deterministic optimiser builds the lowest-cost safe plan with a reason code for every business. Critical loads are blocked by a safety rule, not by price. Results: *window mismatch*, *eligible but not needed*, or *selected*.
4. **Offers:** businesses accept or decline on their own phones. Committing is voluntary.
5. **Verify:** 15-minute meter data (simulated and labelled) is compared with a baseline. *Verified shifted energy = min(peak reduction, alternate-window increase), capped at the commitment*, so nobody is paid for a reduction that never reappeared in the allowed window. In the demo, 16.0 kWh was committed, 14.8 kWh was verified (92.5% delivery) and the 1.2 kWh shortfall is not paid.
6. **Settle and pay:** the operator reviews amounts calculated on the server, then approves. **PayPal Payouts** sends one batch. PeakShift saves the sender batch ID before calling PayPal, so retries can never pay twice. It then reconciles **each recipient item** through **signature-verified webhooks** and by re-checking with PayPal, and a business counts as *paid* only when PayPal confirms its own item.
7. **Analyse:** an **AG Studio** "Energy Intelligence" workspace includes five custom PeakShift widgets (flexibility vs target, load-shift evidence, participant contribution, settlement pulse, cost per verified kWh) that filter each other. **PeakShift Analyst**, built on the AG Studio Agent Framework with Claude, answers questions such as *"Why was NorthCool Storage excluded?"* with read-only tools. It can build widgets, but it has **no way to move money**.

## How we built it

- **Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4**, with a dark operator control room and a light, phone-first business view.
- **PayPal REST in sandbox:**
  - OAuth;
  - Orders v2 create and capture, checked on the server;
  - Payouts with fixed sender IDs, so retries are safe;
  - webhook signature verification;
  - reconciliation per recipient item.

  A clearly labelled simulator runs when no sandbox keys are set.
- **Claude (Anthropic SDK):**
  - structured outputs with strict JSON schemas for profile and event-brief extraction;
  - a server proxy for the AG Studio agent loop, with a model allowlist, size and time limits and a tool allowlist;
  - offline rule-based fallbacks when no key is set.
- **AG Grid / AG Charts / AG Studio:**
  - 9 related, event-scoped data sources, including a derived cost-per-verified-kWh projection built only from PayPal-confirmed payouts;
  - 4 custom widgets;
  - a versioned default report that opens in View mode;
  - autosave on the server with revision conflict detection;
  - the Analyst plus AG Studio's built-in page, widget and data agents.
- **Deterministic core:** integer Wh and integer cents throughout, round-half-up rewards, and unit tests covering the optimiser, verification, timeline order and webhook handling.
- **Storage:** PostgreSQL (Supabase) with row-locked writes for serverless; a file store for local development. Deployed on **Vercel**.

## Challenges we ran into

- Keeping **commitment** separate from **delivery**, and **batch** status from **recipient-item** status, everywhere: a batch can finish while one recipient is still unpaid.
- Making the demo timeline consistent: the event is replayed on a scenario clock so funding, the peak, verification and payouts happen in order, while the real PayPal call times are still recorded alongside.
- Running Postgres safely on serverless through a transaction pooler under bursts of traffic.
- Keeping AI strictly in an interpreting role: AI suggests, deterministic code allocates and verifies, a human approves, and PayPal moves the money.

## Accomplishments that we're proud of

- A complete, working loop with **real PayPal sandbox money**: $12.00 budget funded, then $7.46 in rewards paid to three recipients ($1.92, $2.30, $3.24), each confirmed by signed PayPal webhooks, with $4.54 of the budget left unallocated.
- Every number can be traced: from a reward to its formula, to the 15-minute meter readings, to the PayPal transaction ID.
- An AI analyst that clearly refuses to move money and explains exclusions using the optimiser's own reason codes.

## What we learned

The difficult part of paying many small actors is trust, not the payment itself. People need to see that the measurement is honest, that a retry won't pay twice, and that payment status reflects what actually happened to each recipient.

## What's next

- Real smart-meter data in place of simulated data.
- Multiple peak windows and feeder constraints.
- Venmo and other PayPal payout channels for recipients.
- Pilots with community energy programmes.

---

## Testing instructions (paste into the Devpost "testing instructions" field)

1. Open https://peakshift-seven.vercel.app/demo → **Open operator workspace** (operator: Lenin Briggs). No PeakShift account or installation required: accounts are a one-click demo role switch. Only the PayPal Checkout step needs the sandbox buyer login below.
2. The demo is shared between judges. If the event is already complete, click **Start a fresh run** on the Overview to restore it to *Awaiting funding*. A completed run can also be explored as it is. If another judge is mid-run, the button explains that and becomes available once that run has been idle for 10 minutes.
3. To fund the $12.00 budget, approve PayPal sandbox Checkout with this sandbox **Personal** buyer account:
   - Email: `_judge sandbox buyer email_`
   - Password: `_judge sandbox buyer password_`

   This is a sandbox-only test account; no real money is involved.
4. Then: **Find the lowest-cost plan** → **Publish offers** → *Open as business* and accept the three offers → **Run demo event** → **Run verification** → **Review rewards and settlement** → **Approve and send payouts** → **Payments** to watch each recipient item reconcile.
5. **Energy Intelligence** → **Ask PeakShift Analyst** → "Why was NorthCool Storage excluded from this dispatch?"

The full walkthrough and local setup are in the repository README.
