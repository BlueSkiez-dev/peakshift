// Server-side Claude client (official @anthropic-ai/sdk). The API key never reaches the browser.
// Structured extraction uses structured outputs (`output_config.format` json_schema) — forced
// `tool_choice` is not supported on current models. Without a key, callers use the offline paths.
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 }));

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ClaudeMessage = Anthropic.MessageParam;
export type ClaudeBlock = Anthropic.ContentBlock;

/** Normalise a JSON schema for structured outputs: objects closed (`additionalProperties: false`),
 *  every property listed in `required` (nullable fields stay nullable), type unions → anyOf. */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const s = { ...(schema as Record<string, unknown>) };
  if (Array.isArray(s.type)) {
    const types = s.type as string[];
    delete s.type;
    const rest = { ...s };
    return { anyOf: types.map((t) => strictSchema(t === "null" ? { type: "null" } : { ...rest, type: t })) };
  }
  for (const k of ["minimum", "maximum", "minLength", "maxLength", "multipleOf"]) delete s[k];
  if (s.properties && typeof s.properties === "object") {
    const props = Object.fromEntries(Object.entries(s.properties as Record<string, unknown>).map(([k, v]) => [k, strictSchema(v)]));
    s.properties = props;
    s.required = Object.keys(props);
    s.additionalProperties = false;
  } else if (s.type === "object") {
    s.additionalProperties = false;
  }
  if (s.items) s.items = strictSchema(s.items);
  if (Array.isArray(s.anyOf)) s.anyOf = s.anyOf.map(strictSchema);
  return s;
}

export async function claudeMessages(args: {
  system: string;
  messages: ClaudeMessage[];
  tools?: ClaudeTool[];
  toolChoice?: "auto" | "none";
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Agent loops whose history is re-built by a caller that cannot replay thinking blocks. */
  thinkingOff?: boolean;
}): Promise<{ content: ClaudeBlock[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const r = await client().messages.create(
    {
      model: args.model ?? CLAUDE_MODEL,
      max_tokens: args.maxTokens ?? 16000,
      system: args.system,
      messages: args.messages,
      ...(args.tools?.length ? { tools: args.tools as Anthropic.Tool[], tool_choice: { type: args.toolChoice ?? "auto" } as Anthropic.ToolChoice } : {}),
      ...(args.thinkingOff ? { thinking: { type: "between_tools" } as Anthropic.ThinkingConfigParam } : {}),
    },
    { signal: args.signal, timeout: args.timeoutMs ?? 60_000 },
  );
  if (r.stop_reason === "refusal") throw new Error("Claude declined this request.");
  return { content: r.content, stop_reason: r.stop_reason ?? "end_turn", usage: r.usage };
}

/** Schema-constrained JSON output via structured outputs. */
export async function claudeStructured<T>(system: string, user: string, tool: ClaudeTool): Promise<T> {
  const r = await client().messages.create(
    {
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: `${system}\n\nTask: ${tool.description}`,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: strictSchema(tool.input_schema) as Record<string, unknown> } },
    },
    { timeout: 60_000 },
  );
  if (r.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (r.stop_reason === "max_tokens") throw new Error("Model output was truncated.");
  const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  if (!text) throw new Error("Model returned no structured output");
  return JSON.parse(text) as T;
}

export const isAnthropicError = (e: unknown): e is InstanceType<typeof Anthropic.APIError> => e instanceof Anthropic.APIError;
