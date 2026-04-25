/**
 * PicoFlow Vultr provisioner — creates ONE new instance, idempotent.
 *
 * SAFETY GUARDS (HARD-CODED, NON-NEGOTIABLE):
 *   1. Lists every existing instance before doing anything; protected ones
 *      (tag `do-not-delete` or label/hostname matching carphacom/beta/live.qubitpage)
 *      are explicitly enumerated to stdout so the user can see they were skipped.
 *   2. Idempotent: if an instance with PICOFLOW_LABEL already exists, REUSE it
 *      and exit without creating a duplicate.
 *   3. Cost cap: refuses to POST if monthly_cost > MAX_MONTHLY_COST.
 *   4. Uses ONLY safePost (which itself bans /halt /reinstall /destroy paths).
 *   5. Requires explicit `--confirm` flag before issuing the POST.
 *
 * Usage:
 *   pnpm vultr:provision           # dry-run: shows plan + asks for --confirm
 *   pnpm vultr:provision -- --confirm
 *
 * After creation it polls until the instance is active and writes the IP block
 * to infrastructure/vultr-state.json + stdout.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listInstances,
  listPlans,
  listOs,
  listSshKeys,
  getInstance,
  isProtectedInstance,
  safePost,
  type VultrInstance,
} from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, "..", "..", "infrastructure", "vultr-state.json");

const PICOFLOW_LABEL = process.env.VULTR_LABEL ?? "PicoFlow Hackathon — Arc Nanopayments";
const PICOFLOW_HOSTNAME = process.env.VULTR_HOSTNAME ?? "picoflow-prod";
const PICOFLOW_REGION = process.env.VULTR_REGION ?? "fra";
const PICOFLOW_PLAN = process.env.VULTR_PLAN ?? "vc2-4c-8gb";
const PICOFLOW_TAGS = (process.env.VULTR_TAGS ?? "picoflow,hackathon,arc,do-not-delete")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const MAX_MONTHLY_COST = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cloudInit(): string {
  // Minimal bootstrap: docker, ufw, fail2ban, node 22, pnpm. No auto-deploy.
  const script = `#cloud-config
package_update: true
package_upgrade: true
packages:
  - ufw
  - fail2ban
  - curl
  - git
  - ca-certificates
  - gnupg
runcmd:
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
  - apt-get update
  - DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  - npm i -g pnpm@9.12.0
  - ufw default deny incoming
  - ufw default allow outgoing
  - ufw allow 22/tcp
  - ufw allow 80/tcp
  - ufw allow 443/tcp
  - ufw --force enable
  - systemctl enable --now fail2ban
  - systemctl enable --now docker
`;
  return Buffer.from(script, "utf-8").toString("base64");
}

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");

  console.log("====================================================");
  console.log("  PICOFLOW VULTR PROVISIONER");
  console.log("====================================================");

  // STEP 1 — inventory all existing instances and surface protected ones
  console.log("\n[1/6] Listing existing Vultr instances (read-only)…");
  const existing = await listInstances();
  console.log(`      Found ${existing.length} instance(s).`);
  const protectedExisting = existing.filter(isProtectedInstance);
  if (protectedExisting.length > 0) {
    console.log(`      🛡️  ${protectedExisting.length} PROTECTED — will NEVER be touched:`);
    for (const p of protectedExisting) {
      console.log(`           - ${p.label || p.hostname} (id ${p.id}, ip ${p.main_ip})`);
    }
  } else {
    console.log("      (no protected instances detected)");
  }

  // STEP 2 — idempotency check
  console.log("\n[2/6] Checking for existing PicoFlow instance…");
  const existingPicoflow = existing.find(
    (i) => i.label?.toLowerCase().includes("picoflow") || (i.tags ?? []).map((t) => t.toLowerCase()).includes("picoflow"),
  );
  if (existingPicoflow) {
    console.log(`      ✅ PicoFlow instance already exists: ${existingPicoflow.id} (${existingPicoflow.main_ip})`);
    console.log("      Reusing — no new instance will be created.");
    writeState(existingPicoflow);
    printIpBlock(existingPicoflow);
    return;
  }
  console.log("      No existing PicoFlow instance — proceeding.");

  // STEP 3 — resolve plan, OS, SSH key
  console.log("\n[3/6] Resolving plan, OS, and SSH key…");
  const [plans, oses, sshKeys] = await Promise.all([listPlans(), listOs(), listSshKeys()]);
  const plan = plans.find((p) => p.id === PICOFLOW_PLAN);
  if (!plan) throw new Error(`Plan not found: ${PICOFLOW_PLAN}`);
  if (!plan.locations.includes(PICOFLOW_REGION)) {
    throw new Error(`Plan ${PICOFLOW_PLAN} not available in region ${PICOFLOW_REGION}`);
  }
  if (plan.monthly_cost > MAX_MONTHLY_COST) {
    throw new Error(
      `SAFETY: plan monthly cost $${plan.monthly_cost} exceeds cap $${MAX_MONTHLY_COST}`,
    );
  }
  console.log(`      Plan      : ${plan.id} — ${plan.vcpu_count} vCPU / ${plan.ram} MB / ${plan.disk} GB / $${plan.monthly_cost}/mo`);

  const ubuntu = oses
    .filter((o) => o.family === "ubuntu" && o.arch === "x64")
    .sort((a, b) => b.id - a.id)
    .find((o) => /24\.04/.test(o.name)) ?? oses.find((o) => o.family === "ubuntu" && o.arch === "x64");
  if (!ubuntu) throw new Error("No Ubuntu OS found in Vultr catalog");
  console.log(`      OS        : ${ubuntu.name} (id ${ubuntu.id})`);

  if (sshKeys.length === 0) {
    console.log("      ⚠️  WARNING: no SSH keys registered on this Vultr account.");
    console.log("          The instance will be created with NO ssh key — you will only");
    console.log("          be able to access it via Vultr web console until a key is added.");
  } else {
    console.log(`      SSH keys  : ${sshKeys.length} found, will attach all`);
    for (const k of sshKeys) console.log(`                  - ${k.name} (${k.id})`);
  }

  // STEP 4 — confirmation gate
  console.log("\n[4/6] Provisioning plan:");
  console.log(`      Region    : ${PICOFLOW_REGION}`);
  console.log(`      Hostname  : ${PICOFLOW_HOSTNAME}`);
  console.log(`      Label     : ${PICOFLOW_LABEL}`);
  console.log(`      Tags      : ${PICOFLOW_TAGS.join(", ")}`);
  console.log(`      Backups   : enabled`);
  console.log(`      IPv6      : enabled`);
  console.log(`      Cost      : ~$${plan.monthly_cost}/mo + ~$4.80 backups`);

  if (!confirm) {
    console.log("\n[5/6] DRY RUN — no instance will be created.");
    console.log("      To actually provision, run:");
    console.log("        pnpm vultr:provision -- --confirm");
    return;
  }

  // STEP 5 — POST /v2/instances
  console.log("\n[5/6] Creating instance via POST /v2/instances …");
  const body = {
    region: PICOFLOW_REGION,
    plan: PICOFLOW_PLAN,
    os_id: ubuntu.id,
    label: PICOFLOW_LABEL,
    hostname: PICOFLOW_HOSTNAME,
    tags: PICOFLOW_TAGS,
    sshkey_id: sshKeys.map((k) => k.id),
    backups: "enabled",
    enable_ipv6: true,
    user_data: cloudInit(),
  };
  const created = await safePost<{ instance: VultrInstance }>("/instances", body);
  console.log(`      ✅ Created instance ${created.instance.id}`);

  // STEP 6 — poll until active
  console.log("\n[6/6] Polling until instance is active (this can take 60-180s)…");
  let inst = created.instance;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    inst = await getInstance(created.instance.id);
    process.stdout.write(`      ${i + 1}: status=${inst.status} power=${inst.power_status} server=${inst.server_status}  ip=${inst.main_ip || "(pending)"}\r`);
    if (inst.status === "active" && inst.server_status === "ok" && inst.power_status === "running" && inst.main_ip) break;
  }
  console.log("");
  if (inst.status !== "active") {
    throw new Error(`Instance did not become active in 5 min. Last status: ${inst.status}`);
  }
  writeState(inst);
  printIpBlock(inst);
}

function writeState(inst: VultrInstance): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(inst, null, 2));
}

function printIpBlock(inst: VultrInstance): void {
  console.log("\n==========================================================");
  console.log("PICOFLOW VULTR INSTANCE READY");
  console.log("==========================================================");
  console.log(`Instance ID : ${inst.id}`);
  console.log(`Region      : ${inst.region}`);
  console.log(`IPv4        : ${inst.main_ip}`);
  console.log(`IPv6        : ${inst.v6_main_ip || "(none)"}`);
  console.log(`SSH         : ssh root@${inst.main_ip}`);
  console.log(`Hostname    : ${inst.hostname}`);
  console.log(`Tags        : ${(inst.tags ?? []).join(", ")}`);
  console.log("");
  console.log("NEXT STEPS (USER):");
  console.log("  1. Add DNS A record at qubitpage.com:");
  console.log(`       picoflow  IN  A  ${inst.main_ip}   (TTL 300)`);
  console.log("  2. Reply 'dns ready' once propagated");
  console.log(`     check: dig +short picoflow.qubitpage.com  →  ${inst.main_ip}`);
  console.log("  3. Agent will then run bootstrap + certbot + healthcheck");
  console.log("==========================================================");
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
