/**
 * gateway-worker.test.ts — exercises the worker's branching logic without
 * actually hitting Arc RPC or holding USDC. We stub the Ledger pool methods
 * so we can assert:
 *   1. Idle mode (no relayer key) emits exactly one `idle` event per minute
 *      and does NOT touch the outbox.
 *   2. With a relayer key + a queued job, the worker calls the on-chain path
 *      (we stub viem at the module boundary by injecting RPC failures and
 *      asserting the row is marked failed + retried).
 *
 * Run: npx tsx --test src/gateway-worker.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GatewayWorker, type GatewayWorkerEvent } from "./gateway-worker.js";

function makeStubLedger(opts: {
  pending: number;
  outbox: Array<Record<string, unknown>>;
  onClaim?: () => void;
}) {
  const claimed: Array<Record<string, unknown>> = [];
  const promoted: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  const outboxFailed: Array<{ id: string; reason: string }> = [];
  const outboxDone: string[] = [];
  const onchainTx: unknown[] = [];

  const ledger = {
    pool: {
      query: async (sql: string) => {
        if (sql.includes("FROM settlements WHERE status='pending'")) {
          return { rows: [{ pending: opts.pending, settled_24h: 0, failed_24h: 0 }] };
        }
        return { rows: [{}] };
      },
    },
    claimGatewayOutbox: async (_n: number) => {
      opts.onClaim?.();
      const rows = opts.outbox.splice(0, opts.outbox.length);
      claimed.push(...rows);
      return rows;
    },
    promoteSettlement: async (row: { settlement_id: string }) => {
      promoted.push(row.settlement_id);
    },
    failSettlement: async (id: string, reason: string) => {
      failed.push({ id, reason });
    },
    markOutboxDone: async (id: string) => {
      outboxDone.push(id);
    },
    markOutboxFailed: async (id: string, reason: string) => {
      outboxFailed.push({ id, reason });
    },
    logOnchainTx: async (row: unknown) => {
      onchainTx.push(row);
    },
  };
  return { ledger, claimed, promoted, failed, outboxDone, outboxFailed, onchainTx };
}

test("idle when no relayer key — never touches outbox", async () => {
  const stub = makeStubLedger({ pending: 3, outbox: [], onClaim: () => assert.fail("must not claim outbox") });
  const w = new GatewayWorker({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ledger: stub.ledger as any,
    relayerKey: undefined,
    pollMs: 50,
    batchSize: 4,
  });
  const events: GatewayWorkerEvent[] = [];
  w.on("event", (e: GatewayWorkerEvent) => events.push(e));
  await w.tick();
  const idle = events.find((e) => e.type === "idle");
  const tick = events.find((e) => e.type === "tick");
  assert.ok(tick, "tick event emitted");
  assert.ok(idle, "idle event emitted on missing relayer");
  assert.equal((tick as { pending: number }).pending, 3);
});

test("idle event throttled to once per minute", async () => {
  const stub = makeStubLedger({ pending: 0, outbox: [] });
  const w = new GatewayWorker({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ledger: stub.ledger as any,
    relayerKey: undefined,
    pollMs: 10,
  });
  const idleEvents: GatewayWorkerEvent[] = [];
  w.on("event", (e: GatewayWorkerEvent) => {
    if (e.type === "idle") idleEvents.push(e);
  });
  await w.tick();
  await w.tick();
  await w.tick();
  assert.equal(idleEvents.length, 1, "only one idle event within a minute");
});

test("with bogus relayer key + queued job, marks outbox failed (retry path)", async () => {
  // viem will reject the bogus key when trying to sign the on-chain call.
  const stub = makeStubLedger({
    pending: 1,
    outbox: [{
      outbox_id: "1",
      settlement_id: "11111111-1111-1111-1111-111111111111",
      payment_id: "22222222-2222-2222-2222-222222222222",
      action_id: "33333333-3333-3333-3333-333333333333",
      asset_addr: "0x3600000000000000000000000000000000000000",
      network_id: 5042002,
      from_addr: "0x000000000000000000000000000000000000dEaD",
      to_addr: "0x000000000000000000000000000000000000bEEF",
      value_atomic: "1000",
      valid_after: "0",
      valid_before: "9999999999",
      nonce: "0x" + "ab".repeat(32),
      signature: "0x" + "00".repeat(65),
      attempts: 0,
    }],
  });
  const w = new GatewayWorker({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ledger: stub.ledger as any,
    // valid hex but invalid signature for the auth → tx will revert OR RPC fail.
    relayerKey: "0x" + "11".repeat(32),
    rpcUrl: "http://127.0.0.1:1", // unreachable RPC → guaranteed failure path
    pollMs: 50,
  });
  const events: GatewayWorkerEvent[] = [];
  w.on("event", (e: GatewayWorkerEvent) => events.push(e));
  await w.tick();
  // Either the signature parse threw, or the RPC call threw — both are valid
  // failure paths. Worker must mark outbox as failed (NOT done), and must not
  // promote the settlement.
  assert.equal(stub.outboxDone.length, 0, "did not mark done on failure");
  assert.equal(stub.promoted.length, 0, "did not promote settlement on failure");
  assert.equal(stub.outboxFailed.length, 1, "marked outbox failed once");
  const failedEvt = events.find((e) => e.type === "failed");
  assert.ok(failedEvt, "failed event emitted");
});
