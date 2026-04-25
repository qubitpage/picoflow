/**
 * READ-ONLY Vultr inventory.
 *
 * Lists every existing instance, marks protected ones, and exits 0.
 * Issues ZERO mutating calls. Safe to run anytime.
 *
 * Usage: pnpm vultr:inventory
 */
import { listInstances, isProtectedInstance, type VultrInstance } from "./client.js";

function fmt(inst: VultrInstance): string {
  const protectedFlag = isProtectedInstance(inst) ? " 🛡️  PROTECTED" : "";
  const tags = (inst.tags ?? []).join(",") || "(no tags)";
  return [
    `  • ${inst.label || "(unlabeled)"}${protectedFlag}`,
    `      id        : ${inst.id}`,
    `      hostname  : ${inst.hostname}`,
    `      region    : ${inst.region}`,
    `      plan      : ${inst.plan}`,
    `      status    : ${inst.status} / ${inst.power_status} / ${inst.server_status}`,
    `      ipv4      : ${inst.main_ip}`,
    `      tags      : ${tags}`,
    `      created   : ${inst.date_created}`,
  ].join("\n");
}

async function main(): Promise<void> {
  console.log("====================================================");
  console.log("  VULTR INVENTORY (read-only)");
  console.log("====================================================");
  const instances = await listInstances();
  if (instances.length === 0) {
    console.log("  (no instances on this Vultr account)");
    return;
  }
  console.log(`  Total instances: ${instances.length}`);
  const protectedCount = instances.filter(isProtectedInstance).length;
  console.log(`  Protected      : ${protectedCount}  (will NEVER be modified by PicoFlow scripts)`);
  console.log("----------------------------------------------------");
  for (const inst of instances) console.log(fmt(inst));
  console.log("====================================================");
  console.log("  No mutating calls were made. To provision a new");
  console.log("  PicoFlow instance, run: pnpm vultr:provision");
  console.log("====================================================");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
