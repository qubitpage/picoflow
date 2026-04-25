/**
 * Postgres ledger — single source of truth for every paid action.
 *
 * Tables:
 *   actions      — every paid call (action_id PK, route, buyer, seller, price_atomic, ...)
 *   payments     — x402 EIP-3009 authorizations (links to action_id)
 *   settlements  — Gateway batch settlements or direct onchain tx
 *   splits       — per-action revenue split rows (one per recipient)
 *   bonds        — ProofMesh bond stakes/slashes/refunds
 *   reputations  — ERC-8004 reputation scores
 *   onchain_tx   — Arc tx log (deposit/withdraw/contract events) — proof lane
 */
import pg from "pg";
const { Pool } = pg;

export interface LedgerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max?: number;
}

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS actions (
  action_id      uuid PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  route          text NOT NULL,
  method         text NOT NULL DEFAULT 'GET',
  buyer_addr     text NOT NULL,
  seller_label   text NOT NULL,
  seller_addr    text NOT NULL,
  price_atomic   numeric(38,0) NOT NULL,
  price_human    text NOT NULL,
  asset_addr     text NOT NULL,
  network_id     int NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  result_hash    text,
  latency_ms     int,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_actions_buyer ON actions (buyer_addr);
CREATE INDEX IF NOT EXISTS idx_actions_seller ON actions (seller_label);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions (created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  payment_id     uuid PRIMARY KEY,
  action_id      uuid NOT NULL REFERENCES actions(action_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  nonce          text NOT NULL,
  signature      text NOT NULL,
  valid_after    bigint NOT NULL,
  valid_before   bigint NOT NULL,
  scheme         text NOT NULL DEFAULT 'x402-eip3009',
  verified_at    timestamptz,
  authorization_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_nonce ON payments (nonce);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id  uuid PRIMARY KEY,
  payment_id     uuid NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  confirmed_at   timestamptz,
  mode           text NOT NULL,           -- 'gateway-batch' | 'direct-onchain' | 'mock'
  gateway_settlement_id text,
  tx_hash        text,
  block_number   bigint,
  status         text NOT NULL DEFAULT 'pending',  -- pending|submitted|settled|failed
  error          text
);
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements (status);

CREATE TABLE IF NOT EXISTS splits (
  id             bigserial PRIMARY KEY,
  action_id      uuid NOT NULL REFERENCES actions(action_id) ON DELETE CASCADE,
  recipient_addr text NOT NULL,
  bps            int NOT NULL,
  amount_atomic  numeric(38,0) NOT NULL,
  paid_at        timestamptz,
  tx_hash        text
);
CREATE INDEX IF NOT EXISTS idx_splits_recipient ON splits (recipient_addr);

CREATE TABLE IF NOT EXISTS bonds (
  bond_id        uuid PRIMARY KEY,
  action_id      uuid REFERENCES actions(action_id) ON DELETE SET NULL,
  claim_id       text NOT NULL,
  staker_addr    text NOT NULL,
  amount_atomic  numeric(38,0) NOT NULL,
  status         text NOT NULL DEFAULT 'staked',  -- staked|slashed|refunded
  validator_addr text,
  stake_tx       text,
  resolve_tx     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_bonds_claim ON bonds (claim_id);

CREATE TABLE IF NOT EXISTS reputations (
  agent_addr     text PRIMARY KEY,
  score          numeric(10,4) NOT NULL DEFAULT 1.0,
  total_claims   int NOT NULL DEFAULT 0,
  slashed        int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onchain_tx (
  tx_hash        text PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  network_id     int NOT NULL,
  kind           text NOT NULL,           -- deposit|withdraw|contract|transfer|metadata
  from_addr      text,
  to_addr        text,
  value_atomic   numeric(38,0),
  block_number   bigint,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_onchain_kind ON onchain_tx (kind);

CREATE TABLE IF NOT EXISTS gemini_traces (
  trace_id       uuid PRIMARY KEY,
  action_id      uuid REFERENCES actions(action_id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  prompt         text NOT NULL,
  tool_calls     jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_text     text,
  model          text NOT NULL,
  duration_ms    int
);

CREATE TABLE IF NOT EXISTS settings (
  key            text PRIMARY KEY,
  value          text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  is_secret      boolean NOT NULL DEFAULT false,
  description    text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settings_category ON settings (category);

-- Per-action upstream provider cost. One row per call to a paid 3rd-party API
-- (Featherless, AI/ML API, AIsa, Gemini, Circle, etc.). Margin is computed as
-- price_atomic (revenue) minus SUM(provider_costs.atomic_cost) for an action.
CREATE TABLE IF NOT EXISTS provider_costs (
  id             bigserial PRIMARY KEY,
  action_id      uuid REFERENCES actions(action_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  provider       text NOT NULL,            -- 'featherless' | 'aimlapi' | 'aisa' | 'gemini' | 'circle' | 'arc-gas'
  unit           text NOT NULL,            -- 'token' | 'request' | 'gas' | 'usdc'
  units          numeric(38,6) NOT NULL,   -- consumption (e.g. 1234 tokens, 1 request, 0.000123 ETH-equivalent)
  atomic_cost    numeric(38,0) NOT NULL,   -- USDC atomic cost (6 decimals) — REAL upstream pricing only
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_provider_costs_action ON provider_costs (action_id);
CREATE INDEX IF NOT EXISTS idx_provider_costs_provider_created ON provider_costs (provider, created_at DESC);

-- Outbox for the gateway-batch worker. Holds the raw EIP-3009 authorization
-- bytes plus the link to its settlement row. Worker drains FOR UPDATE SKIP
-- LOCKED so multiple workers can run safely.
CREATE TABLE IF NOT EXISTS gateway_outbox (
  outbox_id      bigserial PRIMARY KEY,
  settlement_id  uuid NOT NULL REFERENCES settlements(settlement_id) ON DELETE CASCADE,
  payment_id     uuid NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
  action_id      uuid NOT NULL REFERENCES actions(action_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  asset_addr     text NOT NULL,
  network_id     int NOT NULL,
  from_addr      text NOT NULL,
  to_addr        text NOT NULL,
  value_atomic   numeric(38,0) NOT NULL,
  valid_after    bigint NOT NULL,
  valid_before   bigint NOT NULL,
  nonce          text NOT NULL,
  signature      text NOT NULL,
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  picked_at      timestamptz,
  done_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_outbox_done ON gateway_outbox (done_at) WHERE done_at IS NULL;

CREATE TABLE IF NOT EXISTS orgs (
  org_id         uuid PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  name           text NOT NULL,
  contact_email  text,
  monthly_call_limit  bigint,
  notes          text,
  disabled       boolean NOT NULL DEFAULT false,
  CONSTRAINT orgs_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_id         uuid PRIMARY KEY,
  org_id         uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  label          text NOT NULL,
  key_prefix     text NOT NULL,
  key_hash       text NOT NULL,
  scope          text NOT NULL DEFAULT 'tenant',  -- tenant|admin
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  CONSTRAINT api_keys_prefix_unique UNIQUE (key_prefix)
);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'tenant';
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys (org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (key_prefix) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS users (
  user_id       uuid PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'owner',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT users_email_unique UNIQUE (email)
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users (org_id);
`;

export class Ledger {
  readonly pool: pg.Pool;

  constructor(cfg: LedgerConfig) {
    this.pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      max: cfg.max ?? 10,
    });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async insertAction(row: {
    action_id: string;
    route: string;
    method?: string;
    buyer_addr: string;
    seller_label: string;
    seller_addr: string;
    price_atomic: bigint;
    price_human: string;
    asset_addr: string;
    network_id: number;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO actions (action_id, route, method, buyer_addr, seller_label, seller_addr, price_atomic, price_human, asset_addr, network_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        row.action_id,
        row.route,
        row.method ?? "GET",
        row.buyer_addr,
        row.seller_label,
        row.seller_addr,
        row.price_atomic.toString(),
        row.price_human,
        row.asset_addr,
        row.network_id,
        row.meta ?? {},
      ],
    );
  }

  async completeAction(action_id: string, result_hash: string, latency_ms: number): Promise<void> {
    await this.pool.query(
      `UPDATE actions SET status='completed', result_hash=$2, latency_ms=$3 WHERE action_id=$1`,
      [action_id, result_hash, latency_ms],
    );
  }

  async insertPayment(row: {
    payment_id: string;
    action_id: string;
    nonce: string;
    signature: string;
    valid_after: number;
    valid_before: number;
    authorization_id?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO payments (payment_id, action_id, nonce, signature, valid_after, valid_before, authorization_id, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
      [
        row.payment_id,
        row.action_id,
        row.nonce,
        row.signature,
        row.valid_after,
        row.valid_before,
        row.authorization_id ?? null,
      ],
    );
  }

  async insertSettlement(row: {
    settlement_id: string;
    payment_id: string;
    mode: "gateway-batch" | "direct-onchain" | "mock";
    gateway_settlement_id?: string;
    tx_hash?: string;
    status?: "pending" | "submitted" | "settled" | "failed";
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO settlements (settlement_id, payment_id, mode, gateway_settlement_id, tx_hash, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        row.settlement_id,
        row.payment_id,
        row.mode,
        row.gateway_settlement_id ?? null,
        row.tx_hash ?? null,
        // SAFETY: default to 'pending' so callers must explicitly mark a row
        // 'settled' only after a real on-chain receipt is observed.
        row.status ?? "pending",
      ],
    );
  }

  /**
   * Transition a settlement from 'pending' to 'submitted' the moment its tx
   * hash leaves the relayer (before the receipt is observed). Callers MUST
   * follow up with promoteSettlement() once the receipt confirms, or with
   * failSettlement() if the tx reverts.
   */
  async markSettlementSubmitted(settlement_id: string, tx_hash: string): Promise<void> {
    await this.pool.query(
      `UPDATE settlements
       SET status='submitted', tx_hash=$2, submitted_at=COALESCE(submitted_at, now())
       WHERE settlement_id=$1 AND status IN ('pending','submitted')`,
      [settlement_id, tx_hash],
    );
  }

  async insertSplits(action_id: string, splits: { addr: string; bps: number; amount: bigint }[]): Promise<void> {
    if (splits.length === 0) return;
    const values: string[] = [];
    const args: unknown[] = [action_id];
    splits.forEach((s, i) => {
      const o = i * 3;
      values.push(`($1, $${o + 2}, $${o + 3}, $${o + 4})`);
      args.push(s.addr, s.bps, s.amount.toString());
    });
    await this.pool.query(
      `INSERT INTO splits (action_id, recipient_addr, bps, amount_atomic) VALUES ${values.join(",")}`,
      args,
    );
  }

  async logOnchainTx(row: {
    tx_hash: string;
    network_id: number;
    kind: string;
    from_addr?: string;
    to_addr?: string;
    value_atomic?: bigint;
    block_number?: bigint;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO onchain_tx (tx_hash, network_id, kind, from_addr, to_addr, value_atomic, block_number, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        row.tx_hash,
        row.network_id,
        row.kind,
        row.from_addr ?? null,
        row.to_addr ?? null,
        row.value_atomic?.toString() ?? null,
        row.block_number?.toString() ?? null,
        row.meta ?? {},
      ],
    );
  }

  async logGeminiTrace(row: {
    trace_id: string;
    action_id?: string;
    prompt: string;
    tool_calls: unknown[];
    final_text?: string;
    model: string;
    duration_ms: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO gemini_traces (trace_id, action_id, prompt, tool_calls, final_text, model, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        row.trace_id,
        row.action_id ?? null,
        row.prompt,
        JSON.stringify(row.tool_calls),
        row.final_text ?? null,
        row.model,
        row.duration_ms,
      ],
    );
  }

  async getStats(): Promise<{
    actions: number;
    completed: number;
    failed: number;
    payments: number;
    settlements: number;
    onchain_tx: number;
    total_usdc: string;
    total_atomic: string;
    avg_price: string;
  }> {
    const r = await this.pool.query(/* sql */ `
      SELECT
        (SELECT COUNT(*) FROM actions) AS actions,
        (SELECT COUNT(*) FROM actions WHERE status='completed') AS completed,
        (SELECT COUNT(*) FROM actions WHERE status='failed') AS failed,
        (SELECT COUNT(*) FROM payments) AS payments,
        (SELECT COUNT(*) FROM settlements) AS settlements,
        (SELECT COUNT(*) FROM onchain_tx) AS onchain_tx,
        COALESCE((SELECT SUM(price_atomic) FROM actions WHERE status='completed'), 0) AS total_atomic,
        COALESCE((SELECT AVG(price_atomic) FROM actions WHERE status='completed'), 0) AS avg_atomic
    `);
    const row = r.rows[0];
    return {
      actions: Number(row.actions),
      completed: Number(row.completed),
      failed: Number(row.failed),
      payments: Number(row.payments),
      settlements: Number(row.settlements),
      onchain_tx: Number(row.onchain_tx),
      total_usdc: row.total_atomic.toString(),
      total_atomic: row.total_atomic.toString(),
      avg_price: row.avg_atomic.toString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Provider cost ledger — REAL upstream API costs only. Used by /api/margin
  // and the dashboard ROI charts. Never insert synthetic costs here.
  // ---------------------------------------------------------------------------
  async logProviderCost(row: {
    action_id?: string;
    provider: string;
    unit: "token" | "request" | "gas" | "usdc";
    units: number;
    atomic_cost: bigint;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO provider_costs (action_id, provider, unit, units, atomic_cost, meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        row.action_id ?? null,
        row.provider,
        row.unit,
        row.units,
        row.atomic_cost.toString(),
        row.meta ?? {},
      ],
    );
  }

  async getMarginReport(windowSec = 86_400): Promise<{
    window_sec: number;
    revenue_atomic: string;
    cost_atomic: string;
    margin_atomic: string;
    margin_bps: number;
    by_provider: { provider: string; cost_atomic: string; calls: number }[];
  }> {
    const rev = await this.pool.query(
      `SELECT COALESCE(SUM(price_atomic),0) AS s
       FROM actions
       WHERE status='completed' AND created_at >= now() - ($1 || ' seconds')::interval`,
      [windowSec.toString()],
    );
    const cost = await this.pool.query(
      `SELECT COALESCE(SUM(atomic_cost),0) AS s
       FROM provider_costs
       WHERE created_at >= now() - ($1 || ' seconds')::interval`,
      [windowSec.toString()],
    );
    const byProv = await this.pool.query(
      `SELECT provider, COALESCE(SUM(atomic_cost),0) AS s, COUNT(*)::int AS n
       FROM provider_costs
       WHERE created_at >= now() - ($1 || ' seconds')::interval
       GROUP BY provider
       ORDER BY s DESC`,
      [windowSec.toString()],
    );
    const revBig = BigInt(rev.rows[0].s);
    const costBig = BigInt(cost.rows[0].s);
    const marginBig = revBig - costBig;
    const marginBps = revBig === 0n ? 0 : Number((marginBig * 10000n) / revBig);
    return {
      window_sec: windowSec,
      revenue_atomic: revBig.toString(),
      cost_atomic: costBig.toString(),
      margin_atomic: marginBig.toString(),
      margin_bps: marginBps,
      by_provider: byProv.rows.map((r) => ({
        provider: r.provider,
        cost_atomic: r.s.toString(),
        calls: Number(r.n),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Gateway outbox — settlement worker queue. The tollbooth enqueues; the
  // worker drains FOR UPDATE SKIP LOCKED, submits the EIP-3009 authorization
  // on-chain, and marks the row done with a real tx_hash.
  // ---------------------------------------------------------------------------
  async enqueueGatewayOutbox(row: {
    settlement_id: string;
    payment_id: string;
    action_id: string;
    asset_addr: string;
    network_id: number;
    from_addr: string;
    to_addr: string;
    value_atomic: bigint;
    valid_after: number;
    valid_before: number;
    nonce: string;
    signature: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO gateway_outbox
       (settlement_id, payment_id, action_id, asset_addr, network_id,
        from_addr, to_addr, value_atomic, valid_after, valid_before, nonce, signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.settlement_id,
        row.payment_id,
        row.action_id,
        row.asset_addr,
        row.network_id,
        row.from_addr,
        row.to_addr,
        row.value_atomic.toString(),
        row.valid_after,
        row.valid_before,
        row.nonce,
        row.signature,
      ],
    );
  }

  /**
   * Pick up to `limit` undone outbox rows, marking them picked_at=now in the
   * SAME transaction so a second worker can't grab them. Uses SKIP LOCKED to
   * be safe under concurrent workers.
   */
  async claimGatewayOutbox(limit: number): Promise<Array<{
    outbox_id: string;
    settlement_id: string;
    payment_id: string;
    action_id: string;
    asset_addr: string;
    network_id: number;
    from_addr: string;
    to_addr: string;
    value_atomic: string;
    valid_after: string;
    valid_before: string;
    nonce: string;
    signature: string;
    attempts: number;
  }>> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT outbox_id, settlement_id, payment_id, action_id, asset_addr,
                network_id, from_addr, to_addr, value_atomic, valid_after,
                valid_before, nonce, signature, attempts
         FROM gateway_outbox
         WHERE done_at IS NULL
         ORDER BY outbox_id
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [limit],
      );
      if (r.rowCount && r.rowCount > 0) {
        await client.query(
          `UPDATE gateway_outbox SET picked_at = now(), attempts = attempts + 1
           WHERE outbox_id = ANY($1::bigint[])`,
          [r.rows.map((row) => row.outbox_id)],
        );
      }
      await client.query("COMMIT");
      return r.rows.map((row) => ({
        outbox_id: row.outbox_id.toString(),
        settlement_id: row.settlement_id,
        payment_id: row.payment_id,
        action_id: row.action_id,
        asset_addr: row.asset_addr,
        network_id: Number(row.network_id),
        from_addr: row.from_addr,
        to_addr: row.to_addr,
        value_atomic: row.value_atomic.toString(),
        valid_after: row.valid_after.toString(),
        valid_before: row.valid_before.toString(),
        nonce: row.nonce,
        signature: row.signature,
        attempts: Number(row.attempts),
      }));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async markOutboxDone(outbox_id: string): Promise<void> {
    await this.pool.query(
      `UPDATE gateway_outbox SET done_at = now(), last_error = NULL WHERE outbox_id = $1`,
      [outbox_id],
    );
  }

  async markOutboxFailed(outbox_id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE gateway_outbox SET picked_at = NULL, last_error = $2 WHERE outbox_id = $1`,
      [outbox_id, error.slice(0, 1000)],
    );
  }

  async promoteSettlement(row: {
    settlement_id: string;
    tx_hash: string;
    block_number?: bigint;
    gateway_settlement_id?: string;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE settlements
       SET status='settled', tx_hash=$2, block_number=$3,
           gateway_settlement_id=COALESCE($4, gateway_settlement_id),
           confirmed_at=COALESCE(confirmed_at, now())
       WHERE settlement_id=$1`,
      [
        row.settlement_id,
        row.tx_hash,
        row.block_number?.toString() ?? null,
        row.gateway_settlement_id ?? null,
      ],
    );
  }

  async failSettlement(settlement_id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE settlements SET status='failed', error=$2 WHERE settlement_id=$1`,
      [settlement_id, error.slice(0, 1000)],
    );
  }

  /**
   * Full detail for one action: action row + payment + settlement + splits +
   * provider_costs. Used by /actions/[id] in the dashboard so operators can
   * inspect, retry, or refund a specific paid call.
   */
  async getActionDetail(action_id: string): Promise<{
    action: Record<string, unknown> | null;
    payment: Record<string, unknown> | null;
    settlement: Record<string, unknown> | null;
    splits: Array<Record<string, unknown>>;
    provider_costs: Array<Record<string, unknown>>;
  }> {
    const a = await this.pool.query(
      `SELECT action_id, created_at, route, method, buyer_addr, seller_label, seller_addr,
              price_atomic::text, price_human, asset_addr, network_id, status,
              result_hash, latency_ms, meta
       FROM actions WHERE action_id=$1`,
      [action_id],
    );
    if (a.rowCount === 0) {
      return { action: null, payment: null, settlement: null, splits: [], provider_costs: [] };
    }
    const [p, s, sp, pc] = await Promise.all([
      this.pool.query(
        `SELECT payment_id, action_id, created_at, nonce, signature, valid_after, valid_before,
                scheme, verified_at, authorization_id
         FROM payments WHERE action_id=$1 ORDER BY created_at ASC LIMIT 1`,
        [action_id],
      ),
      this.pool.query(
        `SELECT s.settlement_id, s.payment_id, s.created_at, s.submitted_at, s.confirmed_at,
                s.mode, s.gateway_settlement_id, s.tx_hash, s.block_number::text, s.status, s.error
         FROM settlements s JOIN payments p ON p.payment_id = s.payment_id
         WHERE p.action_id=$1 ORDER BY s.created_at ASC LIMIT 1`,
        [action_id],
      ),
      this.pool.query(
        `SELECT recipient_addr, bps, amount_atomic::text, paid_at, tx_hash
         FROM splits WHERE action_id=$1 ORDER BY id ASC`,
        [action_id],
      ),
      this.pool.query(
        `SELECT provider, unit, units::text, atomic_cost::text, created_at, meta
         FROM provider_costs WHERE action_id=$1 ORDER BY id ASC`,
        [action_id],
      ),
    ]);
    return {
      action: a.rows[0] ?? null,
      payment: p.rows[0] ?? null,
      settlement: s.rows[0] ?? null,
      splits: sp.rows,
      provider_costs: pc.rows,
    };
  }

  async listRecentSettlements(limit = 50): Promise<Array<{
    settlement_id: string;
    payment_id: string;
    action_id: string;
    mode: string;
    status: string;
    tx_hash: string | null;
    block_number: string | null;
    created_at: string;
    error: string | null;
  }>> {
    const r = await this.pool.query(
      `SELECT s.settlement_id, s.payment_id, p.action_id, s.mode, s.status,
              s.tx_hash, s.block_number, s.created_at, s.error
       FROM settlements s
       JOIN payments p ON p.payment_id = s.payment_id
       ORDER BY s.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => ({
      settlement_id: row.settlement_id,
      payment_id: row.payment_id,
      action_id: row.action_id,
      mode: row.mode,
      status: row.status,
      tx_hash: row.tx_hash,
      block_number: row.block_number ? row.block_number.toString() : null,
      created_at: new Date(row.created_at).toISOString(),
      error: row.error,
    }));
  }

  // ---------------------------------------------------------------------------
  // Orgs + API keys (Phase 6b)
  // Bearer auth: the seller checks the Authorization header against api_keys.
  // We store sha256(secret) only — the raw key is shown ONCE at creation time.
  // ---------------------------------------------------------------------------
  async createOrg(row: {
    org_id: string;
    name: string;
    contact_email?: string | null;
    monthly_call_limit?: number | null;
    notes?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO orgs (org_id, name, contact_email, monthly_call_limit, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        row.org_id,
        row.name,
        row.contact_email ?? null,
        row.monthly_call_limit ?? null,
        row.notes ?? null,
      ],
    );
  }

  async setOrgDisabled(org_id: string, disabled: boolean): Promise<void> {
    await this.pool.query(`UPDATE orgs SET disabled=$2 WHERE org_id=$1`, [org_id, disabled]);
  }

  async listOrgs(opts: { limit?: number; offset?: number; q?: string } = {}): Promise<Array<{
    org_id: string;
    name: string;
    contact_email: string | null;
    monthly_call_limit: string | null;
    notes: string | null;
    disabled: boolean;
    created_at: string;
    active_keys: number;
    calls_30d: number;
  }>> {
    const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
    const offset = Math.max(0, opts.offset ?? 0);
    const params: unknown[] = [];
    let where = "";
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim().toLowerCase()}%`);
      where = `WHERE LOWER(o.name) LIKE $${params.length} OR LOWER(COALESCE(o.contact_email, '')) LIKE $${params.length}`;
    }
    params.push(limit, offset);
    const r = await this.pool.query(
      `SELECT o.org_id, o.name, o.contact_email, o.monthly_call_limit, o.notes,
              o.disabled, o.created_at,
              (SELECT COUNT(*)::int FROM api_keys k
                 WHERE k.org_id=o.org_id AND k.revoked_at IS NULL) AS active_keys,
              (SELECT COUNT(*)::int FROM actions a
                 WHERE a.created_at > now() - interval '30 days'
                   AND a.meta->>'org_id' = o.org_id::text) AS calls_30d
       FROM orgs o
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows.map((row) => ({
      org_id: row.org_id,
      name: row.name,
      contact_email: row.contact_email,
      monthly_call_limit: row.monthly_call_limit ? row.monthly_call_limit.toString() : null,
      notes: row.notes,
      disabled: row.disabled,
      created_at: new Date(row.created_at).toISOString(),
      active_keys: Number(row.active_keys),
      calls_30d: Number(row.calls_30d),
    }));
  }

  async countOrgs(q?: string): Promise<number> {
    const params: unknown[] = [];
    let where = "";
    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      where = `WHERE LOWER(name) LIKE $1 OR LOWER(COALESCE(contact_email, '')) LIKE $1`;
    }
    const r = await this.pool.query(`SELECT COUNT(*)::int AS n FROM orgs ${where}`, params);
    return Number(r.rows[0]?.n ?? 0);
  }

  async createApiKey(row: {
    key_id: string;
    org_id: string;
    label: string;
    key_prefix: string;
    key_hash: string;
    scope?: "tenant" | "admin";
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO api_keys (key_id, org_id, label, key_prefix, key_hash, scope)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.key_id, row.org_id, row.label, row.key_prefix, row.key_hash, row.scope ?? "tenant"],
    );
  }

  async revokeApiKey(key_id: string): Promise<void> {
    await this.pool.query(
      `UPDATE api_keys SET revoked_at=now() WHERE key_id=$1 AND revoked_at IS NULL`,
      [key_id],
    );
  }

  async updateApiKey(row: {
    key_id: string;
    label: string;
    scope?: "tenant" | "admin";
  }): Promise<void> {
    await this.pool.query(
      `UPDATE api_keys
       SET label=$2, scope=COALESCE($3, scope)
       WHERE key_id=$1`,
      [row.key_id, row.label, row.scope ?? null],
    );
  }

  async listApiKeys(org_id?: string, opts: { limit?: number; offset?: number } = {}): Promise<Array<{
    key_id: string;
    org_id: string;
    org_name: string;
    label: string;
    key_prefix: string;
    scope: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }>> {
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 200));
    const offset = Math.max(0, opts.offset ?? 0);
    const params: unknown[] = [];
    let where = "";
    if (org_id) {
      params.push(org_id);
      where = `WHERE k.org_id = $${params.length}`;
    }
    params.push(limit, offset);
    const r = await this.pool.query(
      `SELECT k.key_id, k.org_id, o.name AS org_name, k.label, k.key_prefix, k.scope,
              k.created_at, k.last_used_at, k.revoked_at
       FROM api_keys k JOIN orgs o ON o.org_id = k.org_id
       ${where}
       ORDER BY k.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows.map((row) => ({
      key_id: row.key_id,
      org_id: row.org_id,
      org_name: row.org_name,
      label: row.label,
      key_prefix: row.key_prefix,
      scope: row.scope ?? "tenant",
      created_at: new Date(row.created_at).toISOString(),
      last_used_at: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    }));
  }

  /**
   * Authenticate a key and return its scope (tenant|admin). Used by the
   * server's admin gate to allow operator-issued admin keys to act in place
   * of the legacy single shared ADMIN_TOKEN env var.
   */
  async authenticateApiKeyWithScope(prefix: string, suppliedHash: string): Promise<{
    org_id: string;
    org_name: string;
    key_id: string;
    scope: string;
  } | null> {
    const r = await this.pool.query(
      `SELECT k.key_id, k.org_id, k.key_hash, k.scope, o.name AS org_name, o.disabled
       FROM api_keys k JOIN orgs o ON o.org_id = k.org_id
       WHERE k.key_prefix = $1 AND k.revoked_at IS NULL
       LIMIT 1`,
      [prefix],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    if (row.disabled) return null;
    if (row.key_hash !== suppliedHash) return null;
    await this.pool.query(`UPDATE api_keys SET last_used_at=now() WHERE key_id=$1`, [row.key_id]);
    return {
      org_id: row.org_id,
      org_name: row.org_name,
      key_id: row.key_id,
      scope: row.scope ?? "tenant",
    };
  }

  /**
   * Look up an API key by prefix and verify the supplied hash. Returns the
   * org row if valid (and not revoked / not disabled), null otherwise. Updates
   * last_used_at on success. Constant-time compare via timingSafeEqual on the
   * caller side is required — this method only does direct text equality on
   * the precomputed sha256 hex.
   */
  async authenticateApiKey(prefix: string, suppliedHash: string): Promise<{
    org_id: string;
    org_name: string;
    key_id: string;
    monthly_call_limit: number | null;
  } | null> {
    const r = await this.pool.query(
      `SELECT k.key_id, k.org_id, k.key_hash, o.name AS org_name, o.disabled,
              o.monthly_call_limit
       FROM api_keys k JOIN orgs o ON o.org_id = k.org_id
       WHERE k.key_prefix = $1 AND k.revoked_at IS NULL
       LIMIT 1`,
      [prefix],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    if (row.disabled) return null;
    if (row.key_hash !== suppliedHash) return null;
    await this.pool.query(`UPDATE api_keys SET last_used_at=now() WHERE key_id=$1`, [
      row.key_id,
    ]);
    return {
      org_id: row.org_id,
      org_name: row.org_name,
      key_id: row.key_id,
      monthly_call_limit: row.monthly_call_limit ? Number(row.monthly_call_limit) : null,
    };
  }

  // ---------------- users / auth ----------------

  /** Create a brand-new org + owner user atomically. Returns ids. */
  async signupUser(input: {
    user_id: string;
    org_id: string;
    email: string;
    password_hash: string;
    org_name: string;
  }): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO orgs (org_id, name, contact_email, monthly_call_limit)
         VALUES ($1, $2, $3, $4)`,
        [input.org_id, input.org_name, input.email, 100000],
      );
      await c.query(
        `INSERT INTO users (user_id, org_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4, 'owner')`,
        [input.user_id, input.org_id, input.email, input.password_hash],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  /** Look up by email; returns null if not found. */
  async findUserByEmail(email: string): Promise<{
    user_id: string;
    org_id: string;
    email: string;
    password_hash: string;
    role: string;
  } | null> {
    const r = await this.pool.query(
      `SELECT user_id, org_id, email, password_hash, role
       FROM users WHERE email = lower($1) LIMIT 1`,
      [email],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return {
      user_id: row.user_id,
      org_id: row.org_id,
      email: row.email,
      password_hash: row.password_hash,
      role: row.role,
    };
  }

  /** Look up user by id (for session refresh). Returns null if missing. */
  async getUserById(user_id: string): Promise<{
    user_id: string;
    org_id: string;
    email: string;
    org_name: string;
    role: string;
  } | null> {
    const r = await this.pool.query(
      `SELECT u.user_id, u.org_id, u.email, u.role, o.name AS org_name
       FROM users u JOIN orgs o ON o.org_id = u.org_id
       WHERE u.user_id = $1 LIMIT 1`,
      [user_id],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return {
      user_id: row.user_id,
      org_id: row.org_id,
      email: row.email,
      org_name: row.org_name,
      role: row.role,
    };
  }

  async touchUserLogin(user_id: string): Promise<void> {
    await this.pool.query(`UPDATE users SET last_login_at=now() WHERE user_id=$1`, [user_id]);
  }

  /**
   * Admin-only: rewrite a user's password_hash and role. Used by the
   * /api/admin/seed-roles endpoint to bootstrap deterministic demo accounts
   * (admin / seller / public) without exposing role-mutation to end users.
   */
  async adminSetUserCredentials(user_id: string, password_hash: string, role: string): Promise<void> {
    await this.pool.query(
      `UPDATE users SET password_hash=$2, role=$3 WHERE user_id=$1`,
      [user_id, password_hash, role],
    );
  }

  /**
   * Count actions billed to an org since the start of the current UTC month.
   * Backed by the JSON `meta->>'org_id'` index path; works without a schema
   * change because `actions.meta` is jsonb.
   */
  async countActionsThisMonthForOrg(org_id: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT COUNT(*)::bigint AS n
         FROM actions
        WHERE meta->>'org_id' = $1
          AND created_at >= date_trunc('month', now() at time zone 'utc')`,
      [org_id],
    );
    return Number(r.rows[0]?.n ?? 0);
  }
}
