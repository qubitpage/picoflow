/**
 * Build PicoFlow pitch deck PDF from Markdown via Marp CLI.
 *
 * Strategy:
 *   1. Use locally installed @marp-team/marp-cli if available
 *   2. Else use `npx --yes @marp-team/marp-cli` (downloads on first run)
 *   3. On failure, leave a BUILD_INSTRUCTIONS.txt
 *
 * Usage: pnpm docs:pitch
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "docs/pitch/PicoFlow-Pitch.md");
const distDir = resolve(root, "docs/pitch/dist");
const out = resolve(distDir, "PicoFlow-Pitch-v0.1.pdf");

mkdirSync(distDir, { recursive: true });

if (!existsSync(src)) {
  console.error(`[pitch] source not found: ${src}`);
  process.exit(1);
}

function run(cmd, args) {
  console.log(`[pitch] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status === 0;
}

// Marp requires Chromium for PDF; --allow-local-files for theme assets.
const marpArgs = [`"${src}"`, "--pdf", "--allow-local-files", "-o", `"${out}"`];

if (run("marp", marpArgs)) {
  console.log(`[pitch] ✅ ${out}`);
  process.exit(0);
}

if (run("npx", ["--yes", "@marp-team/marp-cli", ...marpArgs])) {
  console.log(`[pitch] ✅ ${out}`);
  process.exit(0);
}

const note = resolve(distDir, "BUILD_INSTRUCTIONS.txt");
writeFileSync(
  note,
  [
    "PicoFlow pitch PDF builder requires Marp CLI + a Chromium runtime.",
    "",
    "Install (Windows):",
    "  npm i -g @marp-team/marp-cli",
    "  # Marp will download Chromium on first run; alternatively:",
    "  winget install --id Google.Chrome",
    "",
    "Then re-run:  pnpm docs:pitch",
    "",
    "Source markdown is at: docs/pitch/PicoFlow-Pitch.md",
  ].join("\n"),
);
console.warn("[pitch] Marp failed — wrote BUILD_INSTRUCTIONS.txt");
process.exit(0);
