// PeakShift Analyst — read-only analytics agent (PRD §9.5).
// Permitted: read event context, query approved datasets, explain stored reason codes, propose widgets.
// There is deliberately NO tool for payments, approvals, rates, budgets, safety flags or meter data.
import type { AppState, DemandEvent } from "../types";
import { buildDatasets, type Dataset, type DatasetName, type WidgetSpec } from "../analytics";
import { claudeEnabled, claudeMessages, CLAUDE_MODEL, type ClaudeMessage } from "./claude";

export interface AnalystReply {
  answer: string;
  sources: { label: string; detail: string }[];
  filters: string;
  widget: WidgetSpec | null;
  calculation: string | null;
  boundary: string | null;
  toolCalls: { name: string; input: unknown }[];
  engine: { mode: "claude" | "offline"; model: string; latencyMs: number };
}

const FORBIDDEN =
  /\b(send|approve|submit|execute|transfer|refund|release|retry|initiate|trigger)\b.*\b(pay|payouts?|payments?|settlement|money|batch|funds?|rewards?)\b|\bpay (them|the|out|everyone|all|now)\b|\b(change|raise|lower|edit|update|set)\b.*\b(rates?|budget|rewards?|verified|meter|safety|critical)\b|\boverride\b|\bmark .* paid\b|\b(turn|switch) (off|on)\b/i;
const BOUNDARY =
  "I can't move money or change settlement data. Settlement approval and payout submission happen in the Payments workflow, where an operator reviews each recipient and confirms. I can show you the payout reconciliation instead.";

const DATASET_NAMES: DatasetName[] = ["demand_curve", "allocation", "verification", "reward_economics", "payout_status", "exclusions"];

function ctx(ev: DemandEvent) {
  return `Event “${ev.name}” on ${ev.eventDate} (${ev.timezone}); peak ${ev.peak.start}–${ev.peak.end}; alternate window ${ev.shift.start}–${ev.shift.end}; target ${(ev.targetWh / 1000).toFixed(1)} kWh (${ev.targetKw} kW avg); budget $${(ev.budgetMinor / 100).toFixed(2)}; status ${ev.status}. Meter data is SIMULATED.`;
}

function summarise(d: Dataset) {
  return JSON.stringify({ title: d.title, description: d.description, fields: d.fields, rows: d.name === "demand_curve" ? d.rows.filter((_, i) => i % 4 === 0) : d.rows });
}

let wid = 0;
const newId = () => `w_agent_${Date.now().toString(36)}_${wid++}`;

// ---------------- Offline intent router (deterministic, data-backed) ----------------
function offline(q: string, ds: Record<DatasetName, Dataset>, ev: DemandEvent): Omit<AnalystReply, "engine"> {
  const t = q.toLowerCase();
  const base = { sources: [] as AnalystReply["sources"], filters: `Event ${ev.id} · ${ev.eventDate} · all participants`, widget: null as WidgetSpec | null, calculation: null as string | null, boundary: null as string | null, toolCalls: [] as AnalystReply["toolCalls"] };
  if (FORBIDDEN.test(t)) return { ...base, answer: BOUNDARY, boundary: "Analyst has read-only tools. No payment, approval or data-editing tool exists.", sources: [] };

  const alloc = ds.allocation.rows;
  const ver = ds.verification.rows;
  const excl = ds.exclusions.rows;

  if (/exclu|northcool|safety|critical|why .*not|blocked/.test(t)) {
    base.toolCalls.push({ name: "query_dataset", input: { dataset: "exclusions" } });
    const hard = excl.filter((r) => r.hard_safety_block);
    const soft = excl.filter((r) => !r.hard_safety_block);
    const lines = excl.map((r) => `• ${r.business} — ${r.reason_code}: ${r.reason}`).join("\n");
    const nc = excl.find((r) => String(r.business).includes("NorthCool"));
    return {
      ...base,
      answer:
        (nc && /northcool/.test(t)
          ? `NorthCool Storage was excluded by a hard safety rule, not on price: ${nc.reason} The optimiser applies this gate before any cost comparison (reason code ${nc.reason_code}).\n\n`
          : "") + (excl.length ? `${excl.length} businesses were not selected — ${hard.length} hard safety exclusion${hard.length === 1 ? "" : "s"}, ${soft.length} soft:\n${lines}` : "No exclusions yet — run the optimiser first."),
      sources: [{ label: "dispatch_plans.candidates", detail: "Stored deterministic reason codes" }],
      widget: excl.length ? { id: newId(), kind: "table", title: "Excluded and unselected businesses", subtitle: "Deterministic reason codes from the optimiser", dataset: "exclusions", series: [{ key: "business", label: "Business" }, { key: "reason_code", label: "Reason code" }, { key: "hard_safety_block", label: "Hard block" }, { key: "reason", label: "Reason" }], createdBy: "analyst", prompt: q } : null,
    };
  }
  if (/commit|verified|deliver|performance/.test(t) && !/cost per/.test(t)) {
    base.toolCalls.push({ name: "query_dataset", input: { dataset: "verification" } }, { name: "create_widget", input: { kind: "bar", dataset: "verification" } });
    if (!ver.length) return { ...base, answer: "There is no verification result for this event yet. Run the demo event and verification first — I won't estimate verified energy.", sources: [] };
    const tc = ver.reduce((a, r) => a + Number(r.committed_kwh), 0);
    const tv = ver.reduce((a, r) => a + Number(r.verified_kwh), 0);
    return {
      ...base,
      answer: `Across ${ver.length} participants, ${tv.toFixed(1)} kWh was verified against ${tc.toFixed(1)} kWh committed (${((tv / tc) * 100).toFixed(1)}%).\n` + ver.map((r) => `• ${r.business}: ${r.verified_kwh} of ${r.committed_kwh} kWh (limited by ${String(r.limited_by).replace("_", " ")})`).join("\n"),
      calculation: "Verified shifted energy = min(peak reduction, alternate-window increase), capped at the accepted commitment, per participant, in integer Wh.",
      sources: [{ label: "verification_runs.participants", detail: "Formula mv-min-peak-rebound-v1" }],
      widget: { id: newId(), kind: "bar", title: "Committed vs verified energy by business", subtitle: "Simulated meter data — hackathon demo", dataset: "verification", x: "business", series: [{ key: "committed_kwh", label: "Committed" }, { key: "verified_kwh", label: "Verified" }], unit: "kWh", createdBy: "analyst", prompt: q },
    };
  }
  if (/cost per|per verified|reward cost|economics|budget/.test(t)) {
    base.toolCalls.push({ name: "query_dataset", input: { dataset: "reward_economics" } }, { name: "create_widget", input: { kind: "bar", dataset: "reward_economics" } });
    const rows = ds.reward_economics.rows;
    if (!rows.length) return { ...base, answer: "Reward economics need a verification result first. Estimated costs are available on the dispatch plan.", sources: [] };
    const total = rows.reduce((a, r) => a + Number(r.verified_reward_usd), 0);
    const kwh = rows.reduce((a, r) => a + Number(r.verified_kwh), 0);
    return {
      ...base,
      answer: `Verified rewards total $${total.toFixed(2)} for ${kwh.toFixed(1)} kWh — a blended $${(total / kwh).toFixed(3)} per verified kWh. ` + rows.map((r) => `${r.business} $${Number(r.cost_per_verified_kwh).toFixed(2)}/kWh`).join(", ") + ".",
      calculation: "Cost per verified kWh = verified reward ÷ verified kWh (equals the agreed rate, by construction).",
      sources: [{ label: "verification_runs + offers", detail: "Agreed rates × verified energy" }],
      widget: { id: newId(), kind: "bar", title: "Reward cost per verified kWh", subtitle: "Verified reward ÷ verified kWh", dataset: "reward_economics", x: "business", series: [{ key: "cost_per_verified_kwh", label: "USD per verified kWh" }], unit: "USD/kWh", createdBy: "analyst", prompt: q },
    };
  }
  if (/select|why .*(these|three|chosen)|optimi|allocat|plan/.test(t)) {
    base.toolCalls.push({ name: "query_dataset", input: { dataset: "allocation" } }, { name: "explain_plan", input: {} });
    const sel = alloc.filter((r) => r.selected);
    if (!sel.length) return { ...base, answer: "No plan has been generated for this event yet.", sources: [] };
    return {
      ...base,
      answer: `The optimiser is deterministic: it filters businesses through safety, window, capacity, rate and data-quality gates, then fills the ${(ev.targetWh / 1000).toFixed(1)} kWh target in ascending rate order.\n` + sel.map((r, i) => `${i + 1}. ${r.business} — ${r.allocated_kwh} kWh at $${Number(r.rate_usd_per_kwh).toFixed(2)}/kWh = $${Number(r.estimated_reward_usd).toFixed(2)}`).join("\n") + `\nThose three reach the target for $${sel.reduce((a, r) => a + Number(r.estimated_reward_usd), 0).toFixed(2)}; cheaper combinations don't exist because every lower-rate eligible kWh is already used.`,
      calculation: "Estimated reward = allocated Wh × rate ÷ 1000, rounded half-up to cents.",
      sources: [{ label: "dispatch_plans", detail: "optimiser lowest-cost-linear-v1" }],
      widget: { id: newId(), kind: "bar", title: "Allocated vs available energy", subtitle: "Deterministic lowest-cost plan", dataset: "allocation", x: "business", series: [{ key: "available_kwh", label: "Available" }, { key: "allocated_kwh", label: "Allocated" }], unit: "kWh", createdBy: "analyst", prompt: q },
    };
  }
  if (/payout|paypal|paid|status|reconcil|unclaimed|fail/.test(t)) {
    base.toolCalls.push({ name: "query_dataset", input: { dataset: "payout_status" } });
    const rows = ds.payout_status.rows;
    if (!rows.length) return { ...base, answer: "No payout batch has been submitted for this event yet.", sources: [] };
    return { ...base, answer: `Batch ${rows[0].paypal_batch_id} is ${rows[0].batch_status}. Item level: ` + rows.map((r) => `${r.business} ${r.item_status} ($${Number(r.amount_usd).toFixed(2)})`).join(", ") + ". A batch-level status never marks recipients paid on its own.", sources: [{ label: "payout_items", detail: "Reconciled item statuses" }], widget: { id: newId(), kind: "table", title: "Payout reconciliation", dataset: "payout_status", series: [{ key: "business", label: "Business" }, { key: "amount_usd", label: "Amount (USD)" }, { key: "item_status", label: "Item status" }], createdBy: "analyst", prompt: q } };
  }
  if (/demand|curve|baseline|peak/.test(t)) {
    base.toolCalls.push({ name: "query_dataset", input: { dataset: "demand_curve" } });
    return { ...base, answer: "Here is the aggregate baseline against event-day energy per 15-minute interval for the participating sites. The peak window shows the reduction; the alternate window shows the moved consumption (alternate-window increase).", sources: [{ label: "meter_readings", detail: "SIMULATED datasets" }], widget: { id: newId(), kind: "area", title: "Demand response curve", subtitle: "Simulated meter data — hackathon demo", dataset: "demand_curve", x: "time", series: [{ key: "baseline_kwh", label: "Baseline" }, { key: "actual_kwh", label: "Event" }], unit: "kWh", createdBy: "analyst", prompt: q } };
  }
  return { ...base, answer: "I can answer questions about this event's allocation, exclusions, verification, reward economics and payout reconciliation, and build a widget from that data. Try “Compare committed and verified energy by business.”", sources: [] };
}

// ---------------- Claude tool-use loop ----------------
const TOOLS = [
  { name: "get_event_context", description: "Read the selected event's parameters and status.", input_schema: { type: "object", properties: {} } },
  { name: "query_dataset", description: `Read one approved analytics dataset. Available: ${DATASET_NAMES.join(", ")}.`, input_schema: { type: "object", required: ["dataset"], properties: { dataset: { type: "string", enum: DATASET_NAMES } } } },
  {
    name: "create_widget",
    description: "Propose a dashboard widget built from an approved dataset. The operator decides whether to add it.",
    input_schema: {
      type: "object",
      required: ["kind", "title", "dataset", "series"],
      properties: {
        kind: { type: "string", enum: ["bar", "line", "area", "table", "kpi", "donut"] },
        title: { type: "string" },
        subtitle: { type: "string" },
        dataset: { type: "string", enum: DATASET_NAMES },
        x: { type: "string" },
        series: { type: "array", items: { type: "object", required: ["key", "label"], properties: { key: { type: "string" }, label: { type: "string" } } } },
        unit: { type: "string", enum: ["kWh", "USD", "%", "USD/kWh"] },
      },
    },
  },
  {
    name: "final_answer",
    description: "Return the final answer to the operator.",
    input_schema: { type: "object", required: ["answer", "sources", "filters"], properties: { answer: { type: "string" }, sources: { type: "array", items: { type: "object", properties: { label: { type: "string" }, detail: { type: "string" } } } }, filters: { type: "string" }, calculation: { type: "string" }, boundary: { type: "string" } } },
  },
];

async function withClaude(q: string, ds: Record<DatasetName, Dataset>, ev: DemandEvent): Promise<Omit<AnalystReply, "engine">> {
  const system = `You are PeakShift Analyst, a read-only analytics assistant embedded in an energy-flexibility operator workspace.
${ctx(ev)}
Rules: Use query_dataset for every number — never estimate. Cite datasets in sources. Say meter data is simulated when relevant.
You cannot approve settlements, send or retry payouts, change rates, budgets, safety flags or meter data — no such tools exist. If asked, explain that settlement approval and payout submission happen in the Payments workflow.
When a chart would help, call create_widget once using real dataset field keys. Finish by calling final_answer with a concise answer (max 120 words).`;
  const messages: ClaudeMessage[] = [{ role: "user", content: q }];
  const calls: AnalystReply["toolCalls"] = [];
  let widget: WidgetSpec | null = null;
  for (let step = 0; step < 6; step++) {
    const r = await claudeMessages({ system, messages, tools: TOOLS, toolChoice: "auto", maxTokens: 8000 });
    // Append the full content (thinking blocks included, unchanged) so the tool loop stays valid.
    messages.push({ role: "assistant", content: r.content as unknown as ClaudeMessage["content"] });
    const uses = r.content.filter((b) => b.type === "tool_use") as { id: string; name: string; input: Record<string, unknown> }[];
    if (!uses.length) {
      const text = r.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      return { answer: text, sources: [], filters: `Event ${ev.id}`, widget, calculation: null, boundary: null, toolCalls: calls };
    }
    const results: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
    for (const u of uses) {
      calls.push({ name: u.name, input: u.input });
      if (u.name === "final_answer") {
        const f = u.input as { answer: string; sources?: AnalystReply["sources"]; filters?: string; calculation?: string; boundary?: string };
        return { answer: f.answer, sources: f.sources ?? [], filters: f.filters ?? `Event ${ev.id}`, widget, calculation: f.calculation ?? null, boundary: f.boundary ?? null, toolCalls: calls };
      }
      let content = "";
      if (u.name === "get_event_context") content = ctx(ev);
      else if (u.name === "query_dataset") content = DATASET_NAMES.includes(u.input.dataset as DatasetName) ? summarise(ds[u.input.dataset as DatasetName]) : "Unknown dataset";
      else if (u.name === "create_widget") {
        const w = u.input as unknown as WidgetSpec;
        const dsn = ds[w.dataset];
        const keys = new Set(dsn ? Object.keys(dsn.rows[0] ?? {}) : []);
        const valid = dsn && w.series?.every((s) => keys.has(s.key)) && (!w.x || keys.has(w.x));
        if (valid) {
          widget = { ...w, id: newId(), createdBy: "analyst", prompt: q };
          content = "Widget proposed to the operator.";
        } else content = `Invalid field keys. Valid keys: ${[...keys].join(", ")}`;
      } else content = "Tool not available.";
      results.push({ type: "tool_result", tool_use_id: u.id, content });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "I couldn't complete that analysis.", sources: [], filters: `Event ${ev.id}`, widget, calculation: null, boundary: null, toolCalls: calls };
}

export async function askAnalyst(s: AppState, ev: DemandEvent, question: string): Promise<AnalystReply> {
  const t0 = Date.now();
  const q = question.slice(0, 500);
  const ds = buildDatasets(s, ev);
  // The boundary is enforced in code as well as in the prompt.
  if (FORBIDDEN.test(q)) {
    return { ...offline(q, ds, ev), engine: { mode: claudeEnabled() ? "claude" : "offline", model: claudeEnabled() ? CLAUDE_MODEL : "peakshift-analyst-rules-v1", latencyMs: Date.now() - t0 } };
  }
  if (claudeEnabled()) {
    try {
      const r = await withClaude(q, ds, ev);
      return { ...r, engine: { mode: "claude", model: CLAUDE_MODEL, latencyMs: Date.now() - t0 } };
    } catch {
      /* fall through to deterministic analyst */
    }
  }
  return { ...offline(q, ds, ev), engine: { mode: "offline", model: "peakshift-analyst-rules-v1", latencyMs: Date.now() - t0 } };
}
