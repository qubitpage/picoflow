import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import {
  ARC_TESTNET,
  TRANSFER_WITH_AUTH_TYPES,
  USDC_DECIMALS,
  decodePaymentHeader,
  decodeSettlementResponseHeader,
  encodePaymentHeader,
  priceToAtomic,
  type PaymentRequired,
  type PriceQuote,
  type SettlementProof,
  type SignedPayment,
} from "@picoflow/x402-facilitator";
import { AgentWalletError } from "./errors.js";
import type { AgentWalletOpts, PaidCallResult, QuoteRequestInput } from "./types.js";

const USDC_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

/**
 * Buyer-side helper for paid x402 HTTP calls.
 *
 * Typical use:
 *
 * ```ts
 * const wallet = new AgentWallet({
 *   privateKey: process.env.BUYER_PRIVATE_KEY as `0x${string}`,
 *   rpcUrl: "https://rpc.testnet.arc.network",
 *   checkBalance: true,
 * });
 *
 * const r = await wallet.paidCall("https://picoflow.qubitpage.com/api/aisa/data?symbol=SOL");
 * console.log(r.status, r.data, r.payment, r.settlement);
 * ```
 */
export class AgentWallet {
  readonly address: Address;
  private readonly privateKey: Hex;
  private readonly fetcher: typeof fetch;
  private readonly opts: Required<Pick<AgentWalletOpts, "asset" | "chainId" | "decimals">> & AgentWalletOpts;
  private cachedClient: PublicClient | null = null;

  constructor(opts: AgentWalletOpts) {
    if (!opts.privateKey) {
      throw new AgentWalletError("MISSING_PRIVATE_KEY", "AgentWallet: privateKey is required");
    }
    const account = privateKeyToAccount(opts.privateKey);
    this.address = account.address;
    this.privateKey = opts.privateKey;
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
    this.opts = {
      asset: opts.asset ?? ARC_TESTNET.usdc,
      chainId: opts.chainId ?? ARC_TESTNET.chainId,
      decimals: opts.decimals ?? USDC_DECIMALS,
      ...opts,
    };
    if (opts.publicClient) this.cachedClient = opts.publicClient;
  }

  /**
   * Negotiate a price with the seller via the optional `/price_quote` endpoint.
   * Returns the issued PriceQuote — the caller must echo `quote.quote_id` (via
   * the `quote_id` query parameter or POST body) on the next paid call so the
   * seller's QuoteEngine accepts the negotiated price.
   *
   * Throws `AgentWalletError("QUOTE_REJECTED")` if the seller declines or the
   * endpoint is missing.
   */
  async requestQuote(quoteEndpoint: string, req: QuoteRequestInput): Promise<PriceQuote> {
    const r = await this.fetcher(quoteEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, buyer: req.buyer ?? this.address }),
    });
    if (r.status === 404) {
      throw new AgentWalletError(
        "QUOTE_REJECTED",
        `seller does not advertise /price_quote at ${quoteEndpoint}`,
        { status: 404 },
      );
    }
    if (!r.ok) {
      const body = await safeText(r);
      throw new AgentWalletError("QUOTE_REJECTED", `quote rejected (${r.status})`, { body });
    }
    const body = (await r.json()) as PriceQuote;
    if (!body.quote_id || !body.price) {
      throw new AgentWalletError("QUOTE_REJECTED", "malformed quote response", { body });
    }
    if (this.opts.verbose) {
      // eslint-disable-next-line no-console
      console.log("[agent-wallet] negotiated quote", body);
    }
    return body;
  }

  /**
   * Issue a paid HTTP call. Handles the full 402 negotiation transparently.
   *
   * If the first response is not 402 (e.g. the endpoint is free or already
   * authorized), returns it as-is. Otherwise signs an EIP-3009 authorization
   * against the challenge and retries with `X-PAYMENT`.
   */
  async paidCall<T = unknown>(url: string, init: RequestInit = {}): Promise<PaidCallResult<T>> {
    const start = Date.now();
    const first = await this.safeFetch(url, init);
    if (first.status !== 402) {
      const data = (await parseBody(first)) as T;
      return { status: first.status, data, totalLatencyMs: Date.now() - start };
    }
    const challenge = await parseChallenge(first);
    if (this.opts.verbose) {
      // eslint-disable-next-line no-console
      console.log("[agent-wallet] 402 challenge", challenge);
    }

    const valueAtomic = priceToAtomic(challenge.price, this.opts.decimals);

    if (this.opts.checkBalance) {
      await this.assertBalance(valueAtomic);
    }

    const signed = await this.sign(challenge);
    const headers = new Headers(init.headers);
    headers.set("X-PAYMENT", encodePaymentHeader(signed));

    const second = await this.safeFetch(url, { ...init, headers });
    if (second.status === 402) {
      const body = await safeText(second);
      throw new AgentWalletError(
        "PAYMENT_RETRY_FAILED",
        "seller rejected signed payment (still 402)",
        { body, signed },
      );
    }
    const data = (await parseBody(second)) as T;

    let settlement: SettlementProof | undefined;
    const respHeader = second.headers.get("X-PAYMENT-RESPONSE");
    if (respHeader) {
      try {
        settlement = decodeSettlementResponseHeader(respHeader);
      } catch {
        // malformed proof — non-fatal; caller can decide how strict to be
      }
    }

    return {
      status: second.status,
      data,
      payment: signed,
      challenge,
      settlement,
      totalLatencyMs: Date.now() - start,
    };
  }

  /**
   * Sign an EIP-3009 `transferWithAuthorization` for an already-known challenge.
   * Useful when the caller wants to inspect/modify the challenge before signing.
   */
  async sign(challenge: PaymentRequired): Promise<SignedPayment> {
    try {
      const value = priceToAtomic(challenge.price, this.opts.decimals);
      const message = {
        from: this.address,
        to: challenge.to,
        value,
        validAfter: BigInt(challenge.validAfter),
        validBefore: BigInt(challenge.validBefore),
        nonce: challenge.nonce,
      };
      const signature = await signTypedData({
        privateKey: this.privateKey,
        domain: challenge.domain,
        types: TRANSFER_WITH_AUTH_TYPES,
        primaryType: "TransferWithAuthorization",
        message,
      });
      return {
        from: this.address,
        to: challenge.to,
        value: value.toString(),
        validAfter: challenge.validAfter,
        validBefore: challenge.validBefore,
        nonce: challenge.nonce,
        signature,
      };
    } catch (err) {
      throw new AgentWalletError("SIGN_FAILED", (err as Error).message, { challenge });
    }
  }

  /**
   * Read the on-chain USDC balance for this wallet. Requires `rpcUrl` or a
   * pre-built `publicClient`.
   */
  async getBalance(): Promise<bigint> {
    const client = this.client();
    try {
      const balance = (await client.readContract({
        address: this.opts.asset,
        abi: USDC_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [this.address],
      })) as bigint;
      return balance;
    } catch (err) {
      throw new AgentWalletError("RPC_FAILED", (err as Error).message, { asset: this.opts.asset });
    }
  }

  // ---- internals ----

  private async assertBalance(valueAtomic: bigint): Promise<void> {
    const balance = await this.getBalance();
    if (balance < valueAtomic) {
      throw new AgentWalletError(
        "INSUFFICIENT_BALANCE",
        `balance ${balance} < required ${valueAtomic}`,
        { balance: balance.toString(), required: valueAtomic.toString() },
      );
    }
  }

  private client(): PublicClient {
    if (this.cachedClient) return this.cachedClient;
    if (!this.opts.rpcUrl) {
      throw new AgentWalletError(
        "RPC_FAILED",
        "rpcUrl is required for on-chain reads (or pass a publicClient)",
      );
    }
    const chain = defineChain({
      id: this.opts.chainId,
      name: "Arc",
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: this.opts.decimals },
      rpcUrls: { default: { http: [this.opts.rpcUrl] } },
    });
    this.cachedClient = createPublicClient({ chain, transport: http(this.opts.rpcUrl) });
    return this.cachedClient;
  }

  private async safeFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (err) {
      throw new AgentWalletError("NETWORK_ERROR", (err as Error).message, { url });
    }
  }
}

async function parseChallenge(r: Response): Promise<PaymentRequired> {
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new AgentWalletError("INVALID_CHALLENGE", `expected JSON 402 body, got "${ct}"`);
  }
  const body = (await r.json()) as PaymentRequired;
  if (!body.scheme || !body.price || !body.to || !body.nonce) {
    throw new AgentWalletError("INVALID_CHALLENGE", "missing required fields", { body });
  }
  return body;
}

async function parseBody(r: Response): Promise<unknown> {
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return r.json();
  return r.text();
}

async function safeText(r: Response): Promise<string> {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

// Re-export the header helpers for convenience so callers don't need to
// depend on @picoflow/x402-facilitator directly when they just want to
// decode a payment header from a server-side log line.
export { decodePaymentHeader, encodePaymentHeader };
