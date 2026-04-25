/**
 * Build PicoFlow whitepaper PDF from Markdown via pandoc.
 *
 * Tries (in order):
 *   1. pandoc + xelatex with the warm-enterprise template (full quality)
 *   2. pandoc with default LaTeX (good quality)
 *   3. pandoc → HTML → wkhtmltopdf (fallback)
 *   4. Falls back to writing a status note explaining how to install pandoc
 *
 * Usage: pnpm docs:whitepaper
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "docs/whitepaper/PicoFlow-Whitepaper.md");
const tpl = resolve(root, "docs/whitepaper/template.tex");
const distDir = resolve(root, "docs/whitepaper/dist");
const out = resolve(distDir, "PicoFlow-Whitepaper-v0.2.pdf");

mkdirSync(distDir, { recursive: true });

function have(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
    stdio: "ignore",
    shell: true,
  });
  return r.status === 0;
}

function run(cmd, args) {
  console.log(`[whitepaper] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status === 0;
}

if (!existsSync(src)) {
  console.error(`[whitepaper] source not found: ${src}`);
  process.exit(1);
}

if (!have("pandoc")) {
  const note = resolve(distDir, "BUILD_INSTRUCTIONS.txt");
  writeFileSync(
    note,
    [
      "PicoFlow whitepaper PDF builder requires pandoc.",
      "",
      "Install on Windows:",
      "  winget install --id JohnMacFarlane.Pandoc",
      "  winget install --id MiKTeX.MiKTeX           # for xelatex",
      "",
      "Then re-run:  pnpm docs:whitepaper",
      "",
      "Source markdown is at: docs/whitepaper/PicoFlow-Whitepaper.md",
    ].join("\n"),
  );
  console.warn("[whitepaper] pandoc not installed — wrote BUILD_INSTRUCTIONS.txt");
  process.exit(0);
}

// Strategy 1: xelatex with template
if (have("xelatex")) {
  if (
    run("pandoc", [
      `"${src}"`,
      "-o",
      `"${out}"`,
      "--pdf-engine=xelatex",
      `--template="${tpl}"`,
      "--toc",
      "--number-sections",
      "--listings",
    ])
  ) {
    console.log(`[whitepaper] ✅ ${out}`);
    process.exit(0);
  }
  console.warn("[whitepaper] xelatex+template failed, trying xelatex without template…");

  // Strategy 1b: xelatex with default template (handles unicode + xmp keywords)
  if (
    run("pandoc", [
      `"${src}"`,
      "-o",
      `"${out}"`,
      "--pdf-engine=xelatex",
      "--toc",
      "--number-sections",
      "-V",
      "geometry:margin=1in",
      "-V",
      "colorlinks=true",
      "-V",
      "linkcolor=blue",
      "-V",
      "urlcolor=blue",
      "-M",
      "keywords=",
    ])
  ) {
    console.log(`[whitepaper] ✅ ${out}`);
    process.exit(0);
  }
  console.warn("[whitepaper] xelatex default failed, trying pdflatex…");
}

// Strategy 2: default LaTeX (strip keywords to avoid \xmpquote)
if (
  run("pandoc", [
    `"${src}"`,
    "-o",
    `"${out}"`,
    "--toc",
    "--number-sections",
    "-M",
    "keywords=",
  ])
) {
  console.log(`[whitepaper] ✅ ${out}`);
  process.exit(0);
}

// Strategy 3: HTML fallback
const htmlOut = out.replace(/\.pdf$/i, ".html");
if (run("pandoc", [`"${src}"`, "-s", "-o", `"${htmlOut}"`, "--toc", "--number-sections"])) {
  console.log(`[whitepaper] ⚠️  PDF engines unavailable; produced HTML: ${htmlOut}`);
  console.log("[whitepaper]    Install MiKTeX or TeX Live to enable PDF output.");
  process.exit(0);
}

console.error("[whitepaper] all strategies failed");
process.exit(1);

