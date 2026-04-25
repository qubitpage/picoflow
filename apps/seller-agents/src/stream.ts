/**
 * StreamMeter — sub-cent per-tick WebSocket billing.
 *
 *   Buyer connects → first message: { auth: <signed-batch-cap> } authorising up to N ticks.
 *   Server emits ticks every ~50ms until cap exhausted, then closes.
 *   Each tick = $0.000001 USDC; 5000 ticks = $0.005 total.
 *
 * For hackathon demo we mock the auth check (any non-empty `auth` accepted)
 * but still record one ledger row per N ticks (default 100) so the explorer
 * can show the rolling settlement.
 */
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { Ledger, ARC_TESTNET, priceToAtomic } from "@picoflow/nanometer-core";

const TICK_PRICE_USDC = "0.000001";
const TICK_INTERVAL_MS = 50;
const SETTLE_EVERY_N_TICKS = 100;

async function main() {
  const ledger = new Ledger({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "picoflow",
    password: process.env.DB_PASSWORD ?? "picoflow",
    database: process.env.DB_NAME ?? "picoflow",
  });
  await ledger.migrate();

  const app = express();
  app.get("/healthz", (_req, res) => res.json({ ok: true, kind: "stream" }));
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/stream" });

  wss.on("connection", (ws) => {
    let authed = false;
    let tickCount = 0;
    let cap = 0;
    let buyerAddr = "0xUnknown";
    let interval: NodeJS.Timeout | null = null;

    ws.on("message", async (raw) => {
      if (authed) return;
      try {
        const msg = JSON.parse(raw.toString()) as { auth?: string; cap?: number; from?: string };
        if (!msg.auth) {
          ws.send(JSON.stringify({ type: "error", reason: "missing auth" }));
          ws.close();
          return;
        }
        authed = true;
        cap = Math.min(50_000, Math.max(1, msg.cap ?? 5000));
        buyerAddr = msg.from ?? "0xStreamBuyer";
        ws.send(JSON.stringify({ type: "ready", cap, tick_price_usdc: TICK_PRICE_USDC }));
        interval = setInterval(async () => {
          if (!ws.OPEN || ws.readyState !== ws.OPEN) {
            if (interval) clearInterval(interval);
            return;
          }
          tickCount += 1;
          ws.send(
            JSON.stringify({
              type: "tick",
              n: tickCount,
              ts: Date.now(),
              value: Math.sin(tickCount / 10) * 100 + 100, // synthetic signal
            }),
          );
          if (tickCount % SETTLE_EVERY_N_TICKS === 0) {
            // record a rolling ledger row for the batch
            try {
              const action_id = randomUUID();
              await ledger.insertAction({
                action_id,
                route: "/stream",
                method: "WS",
                buyer_addr: buyerAddr,
                seller_label: "StreamMeter",
                seller_addr:
                  (process.env.SELLER_ADDR as `0x${string}`) ??
                  "0x000000000000000000000000000000000000aBcD",
                price_atomic: priceToAtomic(TICK_PRICE_USDC) * BigInt(SETTLE_EVERY_N_TICKS),
                price_human: (Number(TICK_PRICE_USDC) * SETTLE_EVERY_N_TICKS).toFixed(6),
                asset_addr: ARC_TESTNET.usdc,
                network_id: ARC_TESTNET.chainId,
                meta: { ticks: SETTLE_EVERY_N_TICKS, batch_n: tickCount / SETTLE_EVERY_N_TICKS },
              });
              await ledger.completeAction(action_id, "0xstreamtick", TICK_INTERVAL_MS * SETTLE_EVERY_N_TICKS);
            } catch (e) {
              console.error("[stream] ledger write failed:", (e as Error).message);
            }
          }
          if (tickCount >= cap) {
            ws.send(JSON.stringify({ type: "done", total_ticks: tickCount }));
            ws.close();
            if (interval) clearInterval(interval);
          }
        }, TICK_INTERVAL_MS);
      } catch (e) {
        ws.send(JSON.stringify({ type: "error", reason: (e as Error).message }));
        ws.close();
      }
    });

    ws.on("close", () => {
      if (interval) clearInterval(interval);
    });
  });

  const port = Number(process.env.STREAM_PORT ?? 3024);
  server.listen(port, () => {
    console.log(`[stream] StreamMeter WS listening on :${port}/stream`);
  });
}

main().catch((e) => {
  console.error("[stream] fatal", e);
  process.exit(1);
});
