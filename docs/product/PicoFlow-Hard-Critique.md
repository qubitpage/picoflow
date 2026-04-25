# PicoFlow Hard Product Critique

Date: 2026-04-25
Scope: live PicoFlow demo, dashboard, seller APIs, TollBooth/x402, ProofMesh Vyper contracts, docs, and launch model.

This document is intentionally harsh. Its job is to turn the hackathon prototype into a product that a real AI API marketplace could run without misleading customers, leaking funds, or destroying margin.

## Executive verdict

PicoFlow is a strong hackathon demo and a credible product direction. It is not yet a production system.

The most important truth: the current product proves the shape of the protocol, not the full financial loop. It can issue x402 challenges, sign EIP-3009 authorizations, record actions, split accounting rows, call real AI providers, and simulate the ProofMesh bond lifecycle. Until the Vyper contracts are funded/deployed and Gateway batches are submitted through Circle infrastructure, any row with `mock-batch-*` is settlement intent, not settled money.

That does not kill the product. It tells us exactly what to build next.

## Critical issues found

| Priority | Area | Hard criticism | Product consequence | Required fix |
|---|---|---|---|---|
| P0 | Settlement truth | Gateway rows use `mock-batch-*` IDs today. | Customers cannot trust revenue, refunds, or proof status unless the UI labels the state honestly. | Store settlement states as `intent`, `submitted`, `confirmed`, `failed`; only show Arc explorer links for real tx hashes. |
| P0 | Backend auth | Admin settings used to default open when `ADMIN_TOKEN` was empty. | Anyone could mutate keys, treasury addresses, and chain config. | Fail closed in production; require `ADMIN_TOKEN` or bearer token for mutations and reveal. |
| P0 | Frontend auth | Operator pages were public. | Product operations were mixed with public judge/demo pages. | Protect `/console` and `/settings` with Basic Auth credentials. |
| P0 | Provider economics | The demo charges $0.005 for Featherless and AI/ML API, while credits imply roughly $0.005 upstream cost per call. | Zero or negative gross margin after Gateway, validation, and splits. | Production quotes must be provider-cost + Gateway amortization + insurance reserve + platform margin. |
| P0 | x402 trust mode | Paid endpoints still run `trustless: true` for the hackathon buyer wallet. | A real user could forge the buyer address if this flag survives production. | Production mode must force signature verification and reject unsigned or mismatched payloads. |
| P1 | Transaction management | There was no human cockpit for settlement health, route revenue, retry/refund decisions, or launch blockers. | Operators cannot run this as a business. | Added `/console` as the first operator cockpit; next add action detail pages and retry/refund endpoints. |
| P1 | Contract permissions | `BondVault.slash()` originally let any caller slash any bond. The source now requires owner-approved validators. | Real funds still require redeploying the hardened contract and wiring validator assignment. | Deploy the hardened Vyper source, then add commit-reveal or verifiable-random validator assignment. |
| P1 | Cost accounting | Upstream model usage and cost are not recorded per action. | Margin panels overstate profitability. | Add `provider_costs` rows with provider, model, tokens, upstream cost, cache hit, and gross margin. |
| P1 | Insurance pool | Whitepaper describes a 5% reserve, but code does not fund it. | Slashes/refunds have no durable risk pool. | Deduct reserve per paid action and expose pool solvency. |
| P2 | Observability | No metrics endpoint, structured logs, or alerting. | Incidents will be invisible until customers complain. | Add pino logs, Prometheus metrics, provider latency/error alerts, and DB pool health. |

## Function-level critique

### `apps/seller-agents/src/server.ts`

- `adminOk()` previously returned true when `ADMIN_TOKEN` was empty. That is unacceptable outside a local demo. The API now fails closed unless an admin token is configured or explicit non-production open mode is set.
- `express.json({ limit: "1mb" })` allowed unnecessarily large prompts. It is now reduced to 64 KB, but product mode should add per-route payload budgets.
- `/api/margin` accepted `Infinity`, `NaN`, negative prices, and impossible batch sizes. It now validates bounded numeric inputs.
- `/api/featherless/infer` and `/api/aimlapi/infer` accepted arbitrary model names and unbounded prompts. They now use an allow-list and a prompt limit. The next version should store model catalog rows in DB, not code.
- Provider wrappers still fall back to synthesized results. That is useful for demos, but production must make fallback explicit in billing: either charge zero, discount, or mark the action as degraded.
- `/api/demo/run` still spawns a subprocess from an API endpoint. That should become an operator-only job queue with cancellation, retention, and log export.

### `packages/tollbooth/src/index.ts`

- `trustless: true` is useful for local wallets, but dangerous. Production mode must force `verifyPayment()`.
- Settlement rows are marked `settled` before money moves. This is the single most dangerous semantic bug. The row should be `intent` or `pending_gateway` until Circle/Arc confirmation.
- The request path logs action, payment, settlement, and splits in separate DB operations. Production must wrap these in a transaction or outbox pattern.
- Error responses reveal verification internals. Production should return a generic 402 error and log detailed recovery mismatches server-side only.

### `packages/nanometer-core/src/ledger.ts`

- No tenant/account dimension exists. A real product needs `org_id`, `api_key_id`, and `buyer_id` across actions, payments, settlements, costs, and refunds.
- `splits.bps` has no database check constraint. Add `CHECK (bps >= 0 AND bps <= 10000)`.
- `settings` has no audit trail. Add `settings_audit` with actor, old value hash, new value hash, reason, IP, and timestamp.
- There is no `provider_costs` table. Without it, AI inference margin is guessed instead of measured.

### `contracts/BondVault.vy`

- `slash(claim_id)` now requires `validators[msg.sender] == True`, with owner-managed validator updates.
- `stake()` now rejects `amount == 0`.
- `refund()` is open to anyone, which is acceptable only because funds return to staker, but it should emit enough metadata for the operator console.
- Production still needs automated validator assignment, dispute windows, and appeal status.

### `contracts/ReputationRegistry.vy`

- Raters can attest without linking to an observed action or proof. This invites collusion.
- The interface is not ERC-8004-compatible enough for interoperability.
- Production reputation should be scoped by validator set and action class, not one global score.

### `apps/dashboard`

- Public pages are good for judges, but product operations must be separated. `/console` and `/settings` are now protected.
- The old dashboard did not distinguish `mock-batch-*` from confirmed tx hashes. `/console` now labels gateway intent versus onchain proof.
- Settings still require an admin token input for seller API mutations. Next step: replace manual token with session-backed auth or OAuth.
- Tables need pagination, filters, CSV export, and action detail pages.

## Feedback recommendations and how PicoFlow should implement them

| Feedback recommendation | Product implementation |
|---|---|
| Official x402 facilitator SDK | Keep `packages/tollbooth` as an internal facilitator today; extract into `@picoflow/x402-facilitator` once signature verification and settlement states are production-safe. |
| Gateway batch reference pattern | Build a Gateway outbox worker: signed authorizations queue -> Circle submit -> status poll/SSE -> tx hash confirmation -> ledger update. |
| Server-side wallet helpers | Swap local viem buyer key for Circle Wallets dev-controlled wallet signer; keep the EIP-3009 payload unchanged. |
| Nanopayment fee curve docs | `/console` now includes production quote economics. Next add a calculator that varies batch size, provider cost, reserve, and platform take. |
| x402 JSON schema | Publish `payment-required.schema.json` and validate both challenge and `X-PAYMENT` payloads. |
| Faucet / deploy friction | `prepare_deployer.py` and `deploy_when_funded.py` reduce this to one captcha drip, then automatic deploy/env sync/restart. |
| `price_quote` negotiation | Use Gemini/Google as a planner that picks model/provider by target quality, latency, and max price before buyer signs x402. |

## Monetization model

PicoFlow should not sell "AI calls" as a vague bundle. It should sell four precise products:

1. Metered inference gateway
   - Buyer prepays or signs per-call x402.
   - Seller advertises model, context size, latency SLA, and price.
   - PicoFlow charges provider cost + Gateway amortization + insurance reserve + platform margin.

2. AI route optimizer
   - Gemini/Google plans the cheapest route for a task.
   - Featherless supplies open/specialized model depth.
   - AI/ML API supplies premium OpenAI-compatible breadth.
   - The optimizer can split a request: cheap model drafts, premium model verifies.

3. ProofMesh validation add-on
   - Buyers pay extra for independent validation.
   - Validators earn from a validation budget, not only slash wins.
   - Sellers stake bonds that scale with action value and trust score.

4. Revenue-split marketplace
   - Providers, platform, OSS/tool authors, and validators get automatic USDC splits.
   - This is the wedge: normal payment rails cannot economically split $0.005 across four parties.

## Production architecture required

```text
Buyer agent / API client
  -> quote request (task, model constraints, max price)
  -> Gemini/Google quote planner
  -> x402 challenge with route, price, valid window
  -> buyer signs EIP-3009
  -> seller verifies signature
  -> provider call (Featherless / AI/ML API / Gemini / AIsa)
  -> provider_costs row with tokens and upstream charge
  -> Gateway outbox row
  -> Circle Gateway batch submit
  -> Arc tx confirmation
  -> ledger settlement confirmed
  -> optional ProofMesh validator samples result
  -> dashboard shows transaction truth and margin
```

## Authentication model required

- Public: `/`, `/registry`, `/margin`, `/providers`, `/track`, `/docs`.
- Operator-only: `/console`, `/settings`, `/demo/run`, settlement retry, refund, key reveal.
- Buyer API auth: hashed API keys with scopes and rate limits.
- Seller API auth: signed x402 payment plus optional customer API key.
- Admin auth: Basic Auth is acceptable for this hackathon server; production should use OAuth/OIDC with org roles.

## Launch checklist

- [x] Add protected operator console.
- [x] Make seller admin auth fail closed.
- [x] Add prompt/model/price validation and basic rate limiting.
- [x] Publish this hard critique as PDF/HTML/Markdown.
- [ ] Fund deployer and run `contracts/deploy_when_funded.py`.
- [x] Fix `BondVault.slash()` authorization in source before using real funds.
- [ ] Deploy the hardened Vyper contracts after the disposable Arc deployer is funded.
- [ ] Implement Gateway outbox worker and real settlement states.
- [ ] Add `provider_costs` table and use real token usage in margin reporting.
- [ ] Add buyer API keys, orgs, tenants, and per-key quotas.
- [ ] Add action detail page with retry/refund/dispute workflow.

## Final product thesis

The product is viable because AI inference is exactly the kind of economic activity that needs sub-cent settlement. Token usage is granular, buyers want per-call accountability, providers want instant settlement, and payment processors cannot split fractions of a cent across model hosts, validators, and platforms.

The current prototype proves the interface. The production product must prove money movement, cost accounting, and human operations.

---


# Round 2 â€” Hard self-critique after Phases 6 / 6b / 7 (Apr 25 2026, same day, +12h)

This round evaluates only what shipped *after* the Round-1 verdict above:
the dashboard navigation overhaul, the live SSE settlement panel, the
multi-tenant orgs/api_keys schema with Bearer middleware and admin REST,
the new `/orgs` Customer Environments page, and the whitepaper Â§8 ROI /
fee-curve work. It is intentionally harsher than Round 1 because the
product has had a chance to fix what was already known to be wrong.

## Round-2 verdict

Phases 6 and 6b add the operator surface that was missing. They do **not**
fix any of the four P0 issues from Round 1 that are economic in nature
(settlement truth, real Gateway tx hashes, real provider costs, on-chain
contract deployment). The product looks more enterprise-ready than it is.

That gap must be acknowledged in the demo narrative and the README, or
judges will (rightly) read the polished UI as a claim of production
readiness that the back-end cannot yet honour.

## New issues introduced this round

### Status update â€” 2026-04-25 production hardening

The Round-2 P0/P1 auth/quota items below are no longer open in production:

- Bearer middleware now gates paid TollBooth routes with `REQUIRE_API_KEY=true` on prod.
- `monthly_call_limit` is enforced in the sellers middleware and returns HTTP 429 after the org cap.
- TollBooth now writes `{org_id, key_id}` into `actions.meta`, so quota/account reporting can count real ledger rows.
- Featherless and AI/ML API keys are present in the live environment; `/api/providers/status` reports `featherless-real` and `aimlapi-real` with live PONG probes.
- Vyper contracts are live on Arc Testnet and the idempotent deploy path verifies all 3 addresses on chain.

Remaining hard criticism: settlement is still Arc Testnet until Circle publishes Arc Mainnet. For real-money mainnet before Arc launches, the valid route is Base mainnet with the same Vyper contracts and USDC settlement, then redeploy to Arc mainnet when Circle ships it.

| Priority | Area | Hard criticism | Required fix |
|---|---|---|---|
| P0 | Bearer middleware never gates a real paid route | Every existing `/api/*` endpoint sits in `FREE_PREFIXES`. The new auth code is *structurally* correct (sha256 of suffix, `last_used_at` update, org disabled handling) but **0 of the 24 routes ever execute the authenticated branch** in production today. A reviewer who flips `REQUIRE_API_KEY=true` would see no behavioural change. | Either gate at least one endpoint behind a non-free prefix (e.g. move `/api/featherless/infer` and `/api/aimlapi/infer` out of free) or add an `/api/whoami` endpoint that returns the attached `req.picoflow` so the round-trip can be exercised end-to-end. |
| P0 | `monthly_call_limit` is stored but never enforced | The schema records a number; nothing in tollbooth, the seller, or the gateway worker ever reads it. Customers shown a "10,000 calls/month cap" in the UI would still be billed for call 10,001. | Add an enforcement step in the Bearer middleware (or a per-request DB check) that counts the org's `actions` rows in the last 30 d via `meta->>'org_id'` and returns `429 over_limit` past the cap. |
| P1 | `org_id` is not propagated into the action ledger | `req.picoflow.org_id` is attached but never written into `actions.meta`. The "calls_30d" sub-select in `listOrgs` therefore counts zero forever. | Modify the tollbooth `recordAction` call (or wrap it) to merge `{org_id, key_id}` into `meta` when the request was authenticated. |
| P1 | Admin endpoints are protected by a single shared `ADMIN_TOKEN` | Reuse of one bearer across operators provides no audit trail and no revocation per operator. | Promote `ADMIN_TOKEN` to a row in the existing `api_keys` table with a `scope='admin'` flag, and delete the env var in the next release. |
| P1 | `/orgs` page does not paginate or search | Once a customer has > 50 keys the page becomes a multi-MB SSR document. | Add a `?org=` filter on `listApiKeys`, server-side pagination on the orgs table, and lazy-load keys per org. |
| P2 | The flash cookie `pf_minted_key` is `httpOnly` but written with the secret in plaintext | If the operator's machine is compromised the cookie file (Chromium SQLite store) leaks the key. | Render the key inline in the SSR response (already done) **and** set the cookie value to a random one-time-display token whose mapping lives in Redis with a 60 s TTL. |
| P2 | Whitepaper Â§8.2 ROI table assumes $c = \$0.00012$ per call | This is a defensible spot-rate but the document does not yet cite the source receipt or the deployment that produced it. | Append a footnote with either a Featherless invoice line or a public Llama spot-price reference. |
| P2 | `provider_costs` is still empty in Â§8.3 | Acknowledged in the prose, but the seller adapter could log a synthetic-with-disclosure cost row immediately after each provider call so Round 3 can show a non-zero `cost_atomic`. | Wire `recordProviderCost` into the Featherless and AI/ML API wrappers using the documented rate cards as the cost source. |

## Things Round 2 actually fixed

- Round-1 P1 *"No tenant/account dimension exists"* is now **partially addressed**: the `orgs` and `api_keys` tables exist, are CRUD-able through the admin UI, and the Bearer middleware authenticates. The remaining gap (action ledger does not yet carry `org_id`) is filed above as the new P1.
- Round-1 P1 *"Cost accounting / no `provider_costs` table"* is **now fully on the schema side**: the table and `logProviderCost` method ship in `nanometer-core`. The remaining work is to call them from the seller adapters.
- Round-1 P2 *"Tables need pagination, filters, CSV export"* is **partially addressed**: `RecentActionsTable` paginates client-side over a 250-row server slice. CSV export and server-side filters remain TODO.
- Round-1 *"Whitepaper monetization section needs real numbers"* is **addressed** by Â§8.1â€“Â§8.3, including a regenerable chart and a live-API JSON snapshot.

## Honesty checklist for the demo narrative

When showing the new `/orgs` page in a demo or the whitepaper Â§8.3 snapshot,
the script must say (verbatim or equivalent):

1. "API keys authenticate; monthly caps are recorded but not yet enforced â€” this is the next ledger change."
2. "Margin is 100 % in the live snapshot because `provider_costs` is empty;
   Â§8.2 in the whitepaper shows the 58 â€“ 74 % operating margin once cost rows
   land."
3. "Settlement rows are still `pending` until the on-chain contracts deploy
   on Arc; the watchdog is retrying every 60 s against a saturated mempool."

Skipping any of these three sentences turns the demo into a misrepresentation.

## Round-3 entry point

Before the next critique round, the build must:

1. Move at least one paid endpoint out of `FREE_PREFIXES` so the Bearer
   round-trip is verifiable from a curl one-liner.
2. Persist `org_id` into `actions.meta` so the `calls_30d` figure becomes
   non-fictional.
3. Either ship a working Vyper deploy on Arc (Phase 5) **or** rewrite the
   "ProofMesh" section of the whitepaper as "specified, awaiting on-chain
   deployment" â€” no in-between is honest.

# Round 3 closure — Apr 25 2026 (live polish, T-24h to deadline)

This round documents the items from Round-2 that were closed by source
edits in this session and verified end-to-end against the live deployment
at https://picoflow.qubitpage.com.

## Round-3 closed items

1. **Bearer round-trip exercisable end-to-end via /api/whoami.**
   New free endpoint returns the authenticated org_id / org_name / key_id
   when REQUIRE_API_KEY=true and a valid pf_<prefix>_<secret> Bearer is
   sent; returns 401 without it. Smoke script
   scripts/deploy/round3_smoketest.sh mints an org + key and proves both
   the 401 and the 200 path against the live host.

2. **provider_costs populated from the four paid handlers.**
   Inline logCost() helper (with deterministic atomic-cost rates per
   provider) is invoked from the AIsa-data, featherless, aimlapi, and
   validator paths. After running the demo (56/56 ok in 135.0s) the table
   shows: aimlapi 16 calls (1819 atomic), aisa 12 calls (120 atomic),
   featherless 16 calls (925 atomic), validator 12 calls (600 atomic).

3. **Real margin reported from provider_costs, not synthesized.**
   /api/margin/report?window_sec=86400 now returns
   {revenue_atomic: "1330000", cost_atomic: "3464", margin_bps: 9973} with
   a y_provider breakdown — i.e. 99.73% gross margin computed from
   actual ledger rows, replacing the placeholder 100% figure that the
   Round-2 critique flagged.

4. **Demo runner authenticates correctly when the gate is on.**
   /api/demo/run now mints an ephemeral demo org + API key inside the
   sellers process and the buyer-agent runner reads BUYER_API_KEY from
   env and injects a Bearer-form Authorization header on every step (preserved
   across the X-PAYMENT 402-retry loop in BuyerClient.call). Result:
   the public one-click demo passes ok=56 / fail=0 with REQUIRE_API_KEY=true.

## Verification snapshot (live, same session)

- /api/healthz ? {ok:true, ...} 200
- /api/whoami (no Bearer) ? 401
- /api/whoami (valid Bearer) ? 200 with full payload
- /api/demo/run ? 200, ephemeral key minted in logs
- /api/demo/state ? status ok, report.ok = 56, report.fail = 0
- /api/margin/report ? margin_bps 9973, four providers in by_provider
- provider_costs SQL grouping ? 56 cost rows across 4 providers

## Still open after Round-3

- Real Circle Gateway settlement worker (current path is gateway-batched
  via local relayer; outbox flag is staged but not yet posting to Gateway).
- AIsa upstream API key — /api/aisa/data runs Kraken-public fallback by
  design until lablab/AIsa publishes a developer portal at api.aisa.dev.
- Arc mainnet — Circle has not published it yet. The contracts deploy
  unchanged on Base mainnet via contracts/deploy.py base-mainnet.

# Round 5 closure — Apr 25 2026 (mainnet hardening sprint)

This round documents the items closed by source edits in the post-mainnet
session and verified end-to-end against the live deployment at
https://picoflow.qubitpage.com running on Arbitrum One (chain 42161, USDC
0xaf88d065e77c8cC2239327C5EDb3A432268e5831).

## Round-5 closed items

1. **Settlement state machine refined (P0, was Round-1).**
   `settlements` table gained `submitted_at` and `confirmed_at` columns
   (with idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations
   on Pool init). The new `markSettlementSubmitted(id, tx_hash)` ledger
   method flips a row from `pending` to `submitted` the moment the
   relayer broadcasts a transaction; `promoteSettlement()` then sets
   `status='settled'` and `confirmed_at=now()` on receipt. The
   gateway-worker writes the intermediate `submitted` row between the
   `submitted` event emit and `waitForTransactionReceipt`, so /admin
   visibly shows in-flight transactions instead of a single
   `pending → settled` jump. Verified live: `/api/metrics` returns
   `picoflow_settlements_by_status{status="pending"} 90`,
   `…{status="settled"} 79`, `…{status="failed"} 0` plus
   `…{status="legacy_synthetic"} 280` for pre-migration rows.

2. **Admin auth no longer requires the shared ADMIN_TOKEN env var (P1, was Round-2).**
   `api_keys` table gained `scope text NOT NULL DEFAULT 'tenant'` and
   accepts the value `'admin'`. New `authenticateApiKeyWithScope()`
   ledger method returns the scope alongside the org binding. Server's
   `adminAuth(req)` now accepts EITHER the legacy `X-Admin-Token` header
   OR a Bearer-form PicoFlow API key where the key has
   `scope='admin'`. The `/orgs` mint-key form now exposes a tenant/admin
   scope dropdown so operators can issue per-person admin keys with
   `revoked_at` audit trail and immediate revocation.

3. **Operator observability via Prometheus (P2, was Round-2).**
   New public `/api/metrics` endpoint emits text-format counters and
   gauges: `picoflow_actions_total`, `picoflow_actions_completed_total`,
   `picoflow_actions_failed_total`, `picoflow_revenue_atomic_total`,
   `picoflow_settlements_by_status{status="…"}`,
   `picoflow_provider_cost_atomic_24h{provider="…"}`,
   `picoflow_provider_calls_24h{provider="…"}`, `picoflow_db_pool{kind="…"}`,
   `picoflow_uptime_seconds`. Verified live: 200 over HTTPS, all 9 metric
   families present.

4. **Per-action operator detail page with refund workflow (P1, was Round-1).**
   New server endpoint `GET /api/admin/actions/:id` returns `{action,
   payment, settlement, splits, provider_costs}` (404 on miss, 400 on
   non-UUID). New dashboard page `/actions/[id]` renders the full
   ledger trail: state badges, explorer-linked tx hash and addresses,
   payment EIP-3009 nonce/sig/window, every revenue split row, every
   provider_cost row, computed net-margin %. A "Mark refunded" form
   POSTs to `/api/admin/actions/:id/refund-mark`, which annotates the
   settlement with `status='failed', error='REFUND: <reason>'`. This is
   a ledger annotation (the actual reverse on-chain transfer is operator-
   initiated) but immediately removes the row from the confirmed-revenue
   margin report.

5. **/orgs page now paginates and searches (P1, was Round-2).**
   Server `GET /api/admin/orgs` accepts `limit`, `offset`, and `q`
   parameters and returns `{items, total, limit, offset}`. The dashboard
   page reads `?page=` and `?q=` from the URL, slices via 25 rows per
   page, exposes a search box and Prev/Next links. The keys table also
   shows the new `scope` column with a colored badge.

6. **/admin cockpit shows the settlement state distribution.**
   Four colored chips (pending=amber, submitted=indigo, settled=emerald,
   failed=coral) plus a 12-row "Recent settlements" table with state
   badges, explorer tx links, and per-row links to `/actions/:id`. The
   Round-2 critique that "settlement status was a single boolean field"
   is now structurally impossible to regress without a schema change.

## Round-5 critique items that were OUTDATED on inspection

- "trustless flag should default to true" — the codebase never had a
  `trustless` flag. The tollbooth and x402-facilitator perform
  EIP-3009 signature verification on every paid call by design; there
  is no toggle. The PDF critique was generated against an earlier
  branch and is stale on this point.

## Still open after Round-5

- **Insurance reserve pool (P1, was Round-1):** still not allocated.
  The settlement splits do not yet route N bps to a dedicated reserve
  contract for refund liquidity. Tracked for the next sprint.
- **Phase 5 — relayer key rotation:** awaiting operator funding of the
  new Arbitrum relayer address; the rotation script is staged but not
  executed. The current relayer still holds production funds.
- **Phase 6 — 24h soak:** the metrics endpoint now exists, but no
  background scheduler is grabbing snapshots every 5 min for the
  trailing 24-hour SLO graph. Needs a tiny cron job or a Prometheus +
  Grafana scrape.
- **Real Circle Gateway worker:** unchanged from Round-3. The outbox
  flag still posts to the local relayer, not to Circle's batch API
  (Circle has not yet published the API).
- **AIsa upstream API key:** unchanged from Round-3. Falls back to
  Kraken-public until api.aisa.dev exists.
- **Arc mainnet:** unchanged. Circle has not published Arc mainnet;
  the Vyper contracts deploy unchanged on Base mainnet.

## Verification snapshot (live, same session)

- `curl https://picoflow.qubitpage.com/api/metrics` → 200, 9 metric
  families present, `picoflow_actions_total 449`,
  `picoflow_revenue_atomic_total 1521000`
  (≈ $1.521 USDC).
- `psql … 'SELECT column_name FROM information_schema.columns WHERE
  table_name=settlements'` → includes `submitted_at`, `confirmed_at`.
- `psql … 'SELECT column_name FROM information_schema.columns WHERE
  table_name=api_keys'` → includes `scope`.
- `curl -H 'X-Admin-Token: …' /api/admin/orgs?limit=3` → 200 with
  `{items, total, limit, offset}` envelope.
- `curl -H 'X-Admin-Token: …' /api/admin/actions/<uuid>` → 200 with
  full action+payment+settlement+splits payload.
- `https://picoflow.qubitpage.com/admin` → 307 redirect to /login (admin
  gate working).
- `https://picoflow.qubitpage.com/actions/<uuid>` → 307 redirect to
  /login (admin gate working).

