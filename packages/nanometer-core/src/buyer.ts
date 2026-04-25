/**
 * Buyer client — wraps an HTTP fetch with automatic x402 negotiation.
 *
 * Flow:
 *   GET /resource → 402 + PAYMENT-REQUIRED → sign EIP-3009 with privateKey
 *                 → re-request with X-PAYMENT header → 200 + result.
 *
 * Real-world: replace `signEip3009` with Circle Gateway's GatewayClient
 * which deposits once and signs ephemeral authorizations against the
 * unified balance. This implementation directly signs EIP-3009 against
 * USDC on Arc Testnet — works without Circle account.
 */
import { type Address, type Hex } from "viem";
import { privateKeyToAccount, signTypedData } from "viem/accounts";
import {
  decodeResponseHeader,
  encodePaymentHeader,
  priceToAtomic,
  TRANSFER_WITH_AUTH_TYPES,
  type PaymentRequired,
  type SettlementProof,
  type SignedPayment,
} from "./x402.js";

export interface BuyerOpts {
  /** EOA private key (Arc Testnet). Required for real signing. */
  privateKey?: Hex;
  /** USDC decimals (default 6) */
  decimals?: number;
  /** Optional fetch override (for tests / custom transport) */
  fetcher?: typeof fetch;
  /** If true, log negotiation steps to console */
  verbose?: boolean;
}

export interface BuyerCallResult<T = unknown> {
  status: number;
  data: T;
  payment?: SignedPayment;
  challenge?: PaymentRequired;
  settlement?: SettlementProof;
  totalLatencyMs: number;
}

export class BuyerClient {
  private readonly opts: BuyerOpts;
  private readonly account: ReturnType<typeof privateKeyToAccount> | null;
  private readonly fetcher: typeof fetch;

  constructor(opts: BuyerOpts = {}) {
    this.opts = opts;
    this.account = opts.privateKey ? privateKeyToAccount(opts.privateKey) : null;
    this.fetcher = opts.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  get address(): Address | null {
    return this.account?.address ?? null;
  }

  async call<T = unknown>(
    url: string,
    init: RequestInit = {},
  ): Promise<BuyerCallResult<T>> {
    const start = Date.now();
    // 1. initial request
    const first = await this.fetcher(url, init);
    if (first.status !== 402) {
      const data = (await this.parseBody(first)) as T;
      return { status: first.status, data, totalLatencyMs: Date.now() - start };
    }
    // 2. parse PAYMENT-REQUIRED
    const challenge = (await first.json()) as PaymentRequired;
    if (this.opts.verbose) console.log("[buyer] 402 challenge", challenge);

    const signed = await this.signChallenge(challenge);
    if (this.opts.verbose) console.log("[buyer] signed", signed);

    // 3. retry with X-PAYMENT
    const headers = new Headers(init.headers);
    headers.set("X-PAYMENT", encodePaymentHeader(signed));
    const second = await this.fetcher(url, { ...init, headers });
    const data = (await this.parseBody(second)) as T;

    let settlement: SettlementProof | undefined;
    const respHeader = second.headers.get("X-PAYMENT-RESPONSE");
    if (respHeader) {
      try {
        settlement = decodeResponseHeader(respHeader);
      } catch {
        /* ignore malformed */
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

  async signChallenge(challenge: PaymentRequired): Promise<SignedPayment> {
    if (!this.account) throw new Error("BuyerClient: no privateKey configured");
    const decimals = this.opts.decimals ?? 6;
    const value = priceToAtomic(challenge.price, decimals);
    const message = {
      from: this.account.address,
      to: challenge.to,
      value,
      validAfter: BigInt(challenge.validAfter),
      validBefore: BigInt(challenge.validBefore),
      nonce: challenge.nonce,
    };
    const signature = await signTypedData({
      privateKey: this.opts.privateKey!,
      domain: challenge.domain,
      types: TRANSFER_WITH_AUTH_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });
    return {
      from: this.account.address,
      to: challenge.to,
      value: value.toString(),
      validAfter: challenge.validAfter,
      validBefore: challenge.validBefore,
      nonce: challenge.nonce,
      signature,
    };
  }

  private async parseBody(r: Response): Promise<unknown> {
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return r.json();
    return r.text();
  }
}
