/**
 * In-process capability registry. In production: backed by Postgres + ERC-8004
 * onchain registry. For demo: a TypeScript object with seller endpoints.
 */
import type { SplitSpec } from "./x402.js";

export interface RegisteredCapability {
  endpoint: string;          // route on TollBooth
  label: string;             // human-readable seller name
  category: string;          // "data" | "inference" | "validation" | "stream" | ...
  description: string;
  price_usdc: string;        // e.g. "0.005"
  seller_addr: `0x${string}`;
  splits?: SplitSpec[];
  upstream?: string;         // origin URL TollBooth proxies to (or "synthesized")
  tags: string[];
  reputation?: number;       // 0..1
  added_at: number;
}

export class CapabilityRegistry {
  private store = new Map<string, RegisteredCapability>();

  register(cap: Omit<RegisteredCapability, "added_at">): RegisteredCapability {
    const full: RegisteredCapability = { ...cap, added_at: Date.now() };
    this.store.set(cap.endpoint, full);
    return full;
  }

  get(endpoint: string): RegisteredCapability | undefined {
    return this.store.get(endpoint);
  }

  all(): RegisteredCapability[] {
    return [...this.store.values()];
  }

  search(query: string, max_price?: number): RegisteredCapability[] {
    const q = query.toLowerCase();
    return this.all()
      .filter((c) => {
        const blob = `${c.label} ${c.description} ${c.tags.join(" ")} ${c.category}`.toLowerCase();
        const matches = blob.includes(q) || c.tags.some((t) => q.includes(t.toLowerCase()));
        const within = max_price === undefined || Number(c.price_usdc) <= max_price;
        return matches && within;
      })
      .sort((a, b) => Number(a.price_usdc) - Number(b.price_usdc));
  }

  rank(metric: "price" | "reputation" | "endpoint"): RegisteredCapability[] {
    const all = this.all();
    if (metric === "price") return all.sort((a, b) => Number(a.price_usdc) - Number(b.price_usdc));
    if (metric === "reputation") return all.sort((a, b) => (b.reputation ?? 0) - (a.reputation ?? 0));
    return all.sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  }
}

export const globalRegistry = new CapabilityRegistry();
