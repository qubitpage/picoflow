#!/usr/bin/env node
/**
 * create-x402-app — scaffold a working x402 paid-API app.
 *
 * Usage:
 *   npx create-x402-app <project-name> [--template seller|buyer|both]
 *
 * Generates:
 *   - server.ts (Express + @picoflow/x402-facilitator)
 *   - buyer.ts  (@picoflow/agent-wallet demo)
 *   - package.json with scripts: dev:server / demo
 *   - README.md walk-through
 *   - .env.example
 *
 * Designed to give a builder an end-to-end paid HTTP loop on Arc Testnet
 * (Circle Sandbox) in under 60 seconds: `npx create-x402-app my-api && cd my-api && npm install && npm run dev`.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Template = "seller" | "buyer" | "both";

interface Args {
  name: string;
  template: Template;
  force: boolean;
  silent: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { name: "", template: "both", force: false, silent: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--template") {
      const v = argv[++i];
      if (v !== "seller" && v !== "buyer" && v !== "both") {
        throw new Error(`--template must be seller|buyer|both, got "${v}"`);
      }
      args.template = v;
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--silent") {
      args.silent = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!args.name) {
      args.name = a;
    } else {
      throw new Error(`unexpected argument "${a}"`);
    }
  }
  if (!args.name) {
    printHelp();
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9-_]{0,40}$/i.test(args.name)) {
    throw new Error(`invalid project name "${args.name}" — use letters, digits, dash, underscore`);
  }
  return args;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`create-x402-app — scaffold a working x402 paid-API app.

USAGE
  npx create-x402-app <project-name> [--template seller|buyer|both] [--force]

OPTIONS
  --template seller   Only the Express paid-API seller
  --template buyer    Only the buyer-agent demo
  --template both     Both (default)
  --force             Overwrite the target directory if it exists
  --silent            Suppress success banner

EXAMPLES
  npx create-x402-app my-paid-api
  npx create-x402-app pay-per-call --template seller
`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const target = resolve(process.cwd(), args.name);
  if (existsSync(target) && !args.force) {
    throw new Error(`directory "${args.name}" already exists — pass --force to overwrite`);
  }
  mkdirSync(target, { recursive: true });

  const here = dirname(fileURLToPath(import.meta.url));
  const templatesRoot = locateTemplates(here);

  const filesToCopy: string[] = ["common"];
  if (args.template === "seller" || args.template === "both") filesToCopy.push("seller");
  if (args.template === "buyer" || args.template === "both") filesToCopy.push("buyer");

  for (const slice of filesToCopy) {
    const src = join(templatesRoot, slice);
    if (!existsSync(src)) continue;
    copyTree(src, target, { name: args.name, template: args.template });
  }

  // Tailor package.json scripts to the selected template.
  patchPackageJson(target, args);

  if (!args.silent) {
    // eslint-disable-next-line no-console
    console.log(`\n  ✔ scaffolded ${args.name} (${args.template})

  next steps:
    cd ${args.name}
    npm install
    cp .env.example .env   # set BUYER_PRIVATE_KEY (any test EOA on Arc Testnet)
    ${args.template === "buyer" ? "npm run demo" : "npm run dev:server"}
${args.template === "both" ? "    # in another shell:\n    npm run demo" : ""}

  docs: https://picoflow.qubitpage.com
`);
  }
}

function locateTemplates(here: string): string {
  // dist/cli.js → ../templates
  const candidates = [
    resolve(here, "..", "templates"),
    resolve(here, "..", "..", "templates"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`templates directory not found (looked in ${candidates.join(", ")})`);
}

interface TemplateContext {
  name: string;
  template: Template;
}

function copyTree(srcDir: string, dstDir: string, ctx: TemplateContext): void {
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const dst = join(dstDir, entry);
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyTree(src, dst, ctx);
    } else {
      const raw = readFileSync(src, "utf-8");
      const rendered = raw
        .replaceAll("__APP_NAME__", ctx.name)
        .replaceAll("__TEMPLATE__", ctx.template);
      writeFileSync(dst, rendered, "utf-8");
    }
  }
}

function patchPackageJson(target: string, args: Args): void {
  const path = join(target, "package.json");
  if (!existsSync(path)) return;
  const pkg = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  pkg.name = args.name;
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  if (args.template === "buyer") {
    delete scripts["dev:server"];
  } else if (args.template === "seller") {
    delete scripts.demo;
  }
  pkg.scripts = scripts;
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

try {
  main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
}
