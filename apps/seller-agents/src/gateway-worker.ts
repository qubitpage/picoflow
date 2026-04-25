/**
 * Gateway Batch Worker — drains the `gateway_outbox` and submits the EIP-3009
 * `transferWithAuthorization` calls on Arc testnet via viem.
 *
 * Two REAL operating modes (no mocks, no synthetic tx hashes):
 *
 *   1. RELAYER_PRIVATE_KEY set → submit each authorization on-chain via the
 *      configured Arc RPC. Returns a real tx hash + block number, promotes the
 *      settlement row to status='settled', and emits an SSE event.
 *
 *   2. RELAYER_PRIVATE_KEY NOT set → worker stays idle. Logs a clear notice
 *      every poll so operators see the gap. Settlement rows remain 'pending'.
 *      We never invent a tx hash.
 *
 * The worker uses Postgres `FOR UPDATE SKIP LOCKED` for safe horizontal scale.
 *
 * Future mode (3) — Circle Gateway HTTP API batch submission — will land when
 * Circle ships the `/v1/gateway/transfers/batch` endpoint publicly. Today the
 * `gateway-batch` row mode and `direct-onchain` mode produce identical proof
 * (tx hash on Arc); only the batching strategy differs.
 */
import { EventEmitter } from "node:events";
import {
  createPublicClient,
  createWalletClient,
  http,
  hexToSignature,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import type { Ledger } from "@picoflow/nanometer-core";
import { ARC_TESTNET, resolveChainFromEnv } from "@picoflow/x402-facilitator";

/** USDC EIP-3009 ABI — minimal, just transferWithAuthorization. */
const USDC_TWA_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/** Build a viem chain definition at runtime from env-resolved settings. */
function buildChain(opts: { chainId: number; rpcUrl: string; networkName: string; nativeSymbol: string; explorer: string }) {
  return defineChain({
    id: opts.chainId,
    name: opts.networkName,
    nativeCurrency: { name: opts.nativeSymbol, symbol: opts.nativeSymbol, decimals: opts.nativeSymbol === "USDC" ? 6 : 18 },
    rpcUrls: {
      default: { http: [opts.rpcUrl] },
      public: { http: [opts.rpcUrl] },
    },
    blockExplorers: {
      default: { name: `${opts.networkName} Explorer`, url: opts.explorer },
    },
  });
}

export type GatewayWorkerEvent =
  | { type: "tick"; ts: number; pending: number; settled_24h: number; failed_24h: number }
  | { type: "submitted"; ts: number; settlement_id: string; tx_hash: string; from: string; to: string; value: string }
  | { type: "settled"; ts: number; settlement_id: string; tx_hash: string; block_number: string; from: string; to: string; value: string }
  | { type: "failed"; ts: number; settlement_id: string; reason: string; attempts: number }
  | { type: "idle"; ts: number; reason: string };

export interface GatewayWorkerOptions {
  ledger: Ledger;
  rpcUrl?: string;
  chainId?: number;
  /** Relayer private key (0x-prefixed). If absent, worker stays idle. */
  relayerKey?: string;
  /** Poll interval in ms. Default 4000. */
  pollMs?: number;
  /** Max rows per drain. Default 8. */
  batchSize?: number;
  /** Emit verbose console logs. Default false. */
  verbose?: boolean;
}

export class GatewayWorker extends EventEmitter {
  private opts: Required<Omit<GatewayWorkerOptions, "relayerKey" | "rpcUrl" | "chainId">> & {
    relayerKey?: string;
    rpcUrl: string;
    chainId: number;
  };
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;
  private idleNoticeAt = 0;

  constructor(opts: GatewayWorkerOptions) {
    super();
    this.opts = {
      ledger: opts.ledger,
      rpcUrl: opts.rpcUrl ?? ARC_TESTNET.rpc,
      chainId: opts.chainId ?? ARC_TESTNET.chainId,
      relayerKey: opts.relayerKey,
      pollMs: opts.pollMs ?? 4000,
      batchSize: opts.batchSize ?? 8,
      verbose: opts.verbose ?? false,
    };
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      try {
        await this.tick();
      } catch (err) {
        console.error("[gateway-worker] tick error:", (err as Error).message);
      }
      if (!this.stopped) this.timer = setTimeout(loop, this.opts.pollMs);
    };
    this.timer = setTimeout(loop, 250);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Single drain pass; safe to call manually for tests. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const stats = await this.opts.ledger.pool.query(
        `SELECT
           (SELECT COUNT(*) FROM settlements WHERE status='pending')::int AS pending,
           (SELECT COUNT(*) FROM settlements WHERE status='settled' AND created_at > now() - interval '24 hours')::int AS settled_24h,
           (SELECT COUNT(*) FROM settlements WHERE status='failed' AND created_at > now() - interval '24 hours')::int AS failed_24h`,
      );
      const row = stats.rows[0];
      this.emit("event", {
        type: "tick",
        ts: Date.now(),
        pending: row.pending,
        settled_24h: row.settled_24h,
        failed_24h: row.failed_24h,
      } satisfies GatewayWorkerEvent);

      if (!this.opts.relayerKey) {
        // Notice once per minute so logs aren't spammed.
        const now = Date.now();
        if (now - this.idleNoticeAt > 60_000) {
          this.idleNoticeAt = now;
          const reason = "RELAYER_PRIVATE_KEY not configured — settlements remain pending until a relayer is wired";
          this.emit("event", { type: "idle", ts: now, reason } satisfies GatewayWorkerEvent);
          if (this.opts.verbose) console.warn(`[gateway-worker] ${reason}`);
        }
        return;
      }

      const claimed = await this.opts.ledger.claimGatewayOutbox(this.opts.batchSize);
      if (claimed.length === 0) return;

      const account = privateKeyToAccount(this.opts.relayerKey as Hex);
      const resolved = resolveChainFromEnv();
      const chain = buildChain({
        chainId: this.opts.chainId,
        rpcUrl: this.opts.rpcUrl,
        networkName: resolved.networkName,
        nativeSymbol: resolved.nativeSymbol,
        explorer: resolved.explorer,
      });
      const wallet = createWalletClient({ account, chain, transport: http(this.opts.rpcUrl) });
      const pub = createPublicClient({ chain, transport: http(this.opts.rpcUrl) });

      for (const job of claimed) {
        try {
          const sig = hexToSignature(job.signature as Hex);
          const txHash = await wallet.writeContract({
            address: job.asset_addr as Address,
            abi: USDC_TWA_ABI,
            functionName: "transferWithAuthorization",
            args: [
              job.from_addr as Address,
              job.to_addr as Address,
              BigInt(job.value_atomic),
              BigInt(job.valid_after),
              BigInt(job.valid_before),
              job.nonce as Hex,
              Number(sig.v ?? 27),
              sig.r,
              sig.s,
            ],
          });
          this.emit("event", {
            type: "submitted",
            ts: Date.now(),
            settlement_id: job.settlement_id,
            tx_hash: txHash,
            from: job.from_addr,
            to: job.to_addr,
            value: job.value_atomic,
          } satisfies GatewayWorkerEvent);

          // Persist the in-flight state so dashboards distinguish
          // "tx submitted, awaiting receipt" from "fully confirmed".
          await this.opts.ledger.markSettlementSubmitted(job.settlement_id, txHash);

          const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
          if (receipt.status !== "success") {
            throw new Error(`tx reverted: ${txHash}`);
          }

          await this.opts.ledger.promoteSettlement({
            settlement_id: job.settlement_id,
            tx_hash: txHash,
            block_number: receipt.blockNumber,
          });
          await this.opts.ledger.logOnchainTx({
            tx_hash: txHash,
            network_id: this.opts.chainId,
            kind: "transfer",
            from_addr: job.from_addr,
            to_addr: job.to_addr,
            value_atomic: BigInt(job.value_atomic),
            block_number: receipt.blockNumber,
            meta: { settlement_id: job.settlement_id, source: "gateway-worker" },
          });
          await this.opts.ledger.markOutboxDone(job.outbox_id);
          this.emit("event", {
            type: "settled",
            ts: Date.now(),
            settlement_id: job.settlement_id,
            tx_hash: txHash,
            block_number: receipt.blockNumber.toString(),
            from: job.from_addr,
            to: job.to_addr,
            value: job.value_atomic,
          } satisfies GatewayWorkerEvent);
        } catch (err) {
          const reason = (err as Error).message ?? String(err);
          await this.opts.ledger.markOutboxFailed(job.outbox_id, reason);
          // After 5 attempts, hard-fail the settlement so it stops re-trying.
          if (job.attempts + 1 >= 5) {
            await this.opts.ledger.failSettlement(job.settlement_id, reason);
          }
          this.emit("event", {
            type: "failed",
            ts: Date.now(),
            settlement_id: job.settlement_id,
            reason,
            attempts: job.attempts + 1,
          } satisfies GatewayWorkerEvent);
          if (this.opts.verbose) console.error("[gateway-worker] settle failed:", reason);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
