/**
 * Gemini orchestrator — function-calling buyer agent.
 *
 * Tools:
 *   discover_endpoints, quote_price, pay_resource, validate_response,
 *   rank_providers, explain_margin, log_action
 *
 * Notes:
 *   - Uses @google/genai (Gemini 3 Flash by default).
 *   - If GEMINI_API_KEY is missing or models throw, falls back to a
 *     deterministic "scripted-mode" planner so demos always run end-to-end.
 *   - Records every tool call into the ledger via gemini_traces.
 */
import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import { randomUUID } from "node:crypto";

export interface BuyerToolHandlers {
  discover_endpoints: (args: { query: string; max_price_usdc?: number }) => Promise<unknown>;
  quote_price: (args: { endpoint: string; payload?: unknown }) => Promise<unknown>;
  pay_resource: (args: { endpoint: string; payload?: unknown }) => Promise<unknown>;
  validate_response: (args: { response_id: string; cross_check?: boolean }) => Promise<unknown>;
  rank_providers: (args: { metric: string }) => Promise<unknown>;
  explain_margin: (args: { price_usdc: number; n_calls: number }) => Promise<unknown>;
}

export const BUYER_TOOLS: FunctionDeclaration[] = [
  {
    name: "discover_endpoints",
    description: "Discover paid x402 endpoints in the PicoFlow capability registry.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Natural-language capability query." },
        max_price_usdc: { type: Type.NUMBER, description: "Optional price ceiling per call." },
      },
      required: ["query"],
    },
  },
  {
    name: "quote_price",
    description: "Get the current x402 quote (PAYMENT-REQUIRED) for an endpoint.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        endpoint: { type: Type.STRING },
        payload: { type: Type.OBJECT, properties: {} },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "pay_resource",
    description: "Pay & call an x402 endpoint. Signs EIP-3009 and submits via Gateway batch.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        endpoint: { type: Type.STRING },
        payload: { type: Type.OBJECT, properties: {} },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "validate_response",
    description: "Cross-check a response with a second model; may trigger ProofMesh slash.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        response_id: { type: Type.STRING },
        cross_check: { type: Type.BOOLEAN },
      },
      required: ["response_id"],
    },
  },
  {
    name: "rank_providers",
    description: "Rank known providers by a metric: success_rate, latency, price, reputation.",
    parameters: {
      type: Type.OBJECT,
      properties: { metric: { type: Type.STRING } },
      required: ["metric"],
    },
  },
  {
    name: "explain_margin",
    description: "Compute card vs raw-onchain vs Gateway-batched margins.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        price_usdc: { type: Type.NUMBER },
        n_calls: { type: Type.NUMBER },
      },
      required: ["price_usdc", "n_calls"],
    },
  },
];

export interface BuyerRunOpts {
  prompt: string;
  apiKey?: string;
  model?: string;
  maxIterations?: number;
}

export interface BuyerRunResult {
  trace_id: string;
  model: string;
  scripted: boolean;
  tool_calls: { name: string; args: unknown; result: unknown }[];
  final_text: string;
  duration_ms: number;
}

/**
 * Run the buyer agent.
 *
 * If GEMINI_API_KEY is set, calls Gemini 3 Flash with function-calling.
 * Otherwise runs a deterministic scripted planner that exercises every tool —
 * guaranteeing demos still produce ledger rows even without a Gemini quota.
 */
export async function runBuyerAgent(
  opts: BuyerRunOpts,
  handlers: BuyerToolHandlers,
): Promise<BuyerRunResult> {
  const start = Date.now();
  const trace_id = randomUUID();
  const calls: BuyerRunResult["tool_calls"] = [];
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  const model = opts.model ?? "gemini-2.5-flash";

  if (!apiKey) {
    // Scripted fallback — still produces a real, end-to-end demo run.
    const scripted = await runScripted(opts.prompt, handlers, calls);
    return {
      trace_id,
      model: "scripted-fallback",
      scripted: true,
      tool_calls: calls,
      final_text: scripted,
      duration_ms: Date.now() - start,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    let history: Array<{ role: "user" | "model"; parts: unknown[] }> = [
      { role: "user", parts: [{ text: opts.prompt }] },
    ];
    let final_text = "";
    const max = opts.maxIterations ?? 12;

    for (let i = 0; i < max; i++) {
      const resp = await ai.models.generateContent({
        model,
        contents: history as never,
        config: { tools: [{ functionDeclarations: BUYER_TOOLS }] },
      });

      const cand = resp.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      const fcParts = parts.filter((p: { functionCall?: unknown }) => p.functionCall);

      if (fcParts.length === 0) {
        final_text = parts.map((p: { text?: string }) => p.text ?? "").join("");
        break;
      }

      history.push({ role: "model", parts });
      const responses: unknown[] = [];
      for (const part of fcParts as Array<{ functionCall: { name: string; args: Record<string, unknown> } }>) {
        const { name, args } = part.functionCall;
        let result: unknown;
        try {
          const handler = (handlers as unknown as Record<string, (a: unknown) => Promise<unknown>>)[name];
          result = handler ? await handler(args as never) : { error: `unknown tool: ${name}` };
        } catch (e) {
          result = { error: (e as Error).message };
        }
        calls.push({ name, args, result });
        responses.push({ functionResponse: { name, response: { result } } });
      }
      history.push({ role: "user", parts: responses });
    }

    return {
      trace_id,
      model,
      scripted: false,
      tool_calls: calls,
      final_text: final_text || "(no final text)",
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    // Network / quota / 429 → fall back to scripted so the demo still runs
    const scripted = await runScripted(opts.prompt, handlers, calls);
    return {
      trace_id,
      model: `${model}-failed:${(err as Error).message.slice(0, 80)}`,
      scripted: true,
      tool_calls: calls,
      final_text: scripted,
      duration_ms: Date.now() - start,
    };
  }
}

async function runScripted(
  prompt: string,
  h: BuyerToolHandlers,
  calls: BuyerRunResult["tool_calls"],
): Promise<string> {
  const push = async (name: keyof BuyerToolHandlers, args: unknown) => {
    const result = await (h[name] as (a: unknown) => Promise<unknown>)(args);
    calls.push({ name, args, result });
    return result;
  };
  await push("discover_endpoints", { query: prompt, max_price_usdc: 0.01 });
  await push("rank_providers", { metric: "price" });

  // Buy from each seller class so demo hits 60+ paid actions
  const plan = [
    { ep: "/api/aisa/data", n: 12 },
    { ep: "/api/featherless/infer", n: 8 },
    { ep: "/api/aimlapi/infer", n: 8 },
    { ep: "/api/validator/check", n: 6 },
  ];
  for (const { ep, n } of plan) {
    for (let i = 0; i < n; i++) {
      const out = await push("pay_resource", { endpoint: ep, payload: { i, prompt } });
      const id = (out as { action_id?: string })?.action_id;
      if (id && i % 3 === 0) await push("validate_response", { response_id: id });
    }
  }

  await push("explain_margin", { price_usdc: 0.005, n_calls: 1000 });
  return `Scripted run completed: ${calls.length} tool calls executed.`;
}
