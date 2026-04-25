/**
 * Build PDF + HTML for every markdown deliverable and stage them
 * for the dashboard's /docs page.
 *
 * Inputs (markdown):
 *   - submission/circle-feedback.md
 *   - DELIVERY_REPORT.md
 *   - README.md
 *   - docs/whitepaper/PicoFlow-Whitepaper.md (re-built fresh as v0.3)
 *   - docs/product/PicoFlow-Hard-Critique.md
 *   - docs/product/PicoFlow-Admin-User-Guide.md
 *
 * Outputs (one PDF + one HTML per doc):
 *   - docs/dist/<slug>.pdf
 *   - docs/dist/<slug>.html
 *   - apps/dashboard/public/docs/<slug>.{pdf,html}   (copied for Next static serving)
 *   - apps/dashboard/public/docs/index.json          (catalogue read by the /docs page)
 *
 * Public catalogue is intentionally limited to one whitepaper and one pitch deck.
 *
 * Usage: node scripts/build-docs.mjs
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distDir = resolve(root, "docs/dist");
const publicDir = resolve(root, "apps/dashboard/public/docs");
mkdirSync(distDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const DOCS_CSS = `
:root{--paper:#F8F6F1;--cream:#FCFAF5;--ink:#1E2330;--muted:#4A5468;--indigo:#3B5BDB;--emerald:#10B981;--amber:#F59E0B;--line:#E5E0D6}
html{background:var(--paper);color:var(--ink)}
body{max-width:980px;margin:0 auto;padding:48px 24px 80px;font:16px/1.68 Inter,Segoe UI,system-ui,sans-serif;background:linear-gradient(180deg,var(--cream),var(--paper));box-shadow:0 0 0 1px var(--line),0 24px 80px rgba(30,35,48,.10)}
h1,h2,h3{line-height:1.15;letter-spacing:-.02em;color:var(--ink)}
h1{font-size:42px;margin-top:0;border-bottom:2px solid var(--line);padding-bottom:18px}h2{font-size:28px;margin-top:42px;color:var(--indigo)}h3{font-size:21px;margin-top:28px}
p,li{color:var(--muted)}strong{color:var(--ink)}a{color:var(--indigo)}
table{width:100%;border-collapse:collapse;margin:24px 0;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 0 0 1px var(--line);break-inside:auto}th,td{border:1px solid var(--line);padding:10px 12px;vertical-align:top}th{background:#EEF2FF;color:#1E3A8A;text-align:left}
pre{background:#111827;color:#F9FAFB;border-radius:16px;padding:18px;overflow:auto;font-size:13px;line-height:1.55}code{font-family:JetBrains Mono,Consolas,monospace}p code,li code{background:#EEF2FF;color:#1E3A8A;border-radius:6px;padding:2px 5px}
blockquote{border-left:5px solid var(--indigo);background:#EEF2FF;margin:24px 0;padding:14px 18px;border-radius:0 14px 14px 0}
img{display:block;max-width:100%;height:auto;border-radius:18px;border:1px solid var(--line);box-shadow:0 14px 40px rgba(30,35,48,.10);background:#fff;margin:18px auto}
p:has(> img){margin:34px 0;padding:16px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 50px rgba(30,35,48,.08);break-inside:avoid;page-break-inside:avoid}
figure{margin:34px 0;padding:16px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 50px rgba(30,35,48,.08);break-inside:avoid}figcaption{text-align:center;color:var(--muted);font-size:13px;margin-top:8px}
#TOC{background:#fff;border:1px solid var(--line);border-radius:18px;padding:16px 20px;margin:24px 0}#TOC ul{margin:.4rem 0}.title{font-size:46px;font-weight:800}.subtitle{color:var(--indigo);font-size:22px;font-weight:700}.author,.date{color:var(--muted)}
@media print{body{box-shadow:none}p:has(> img),figure{page-break-inside:avoid}h1,h2,h3{page-break-after:avoid}}
`;
writeFileSync(resolve(distDir, "picoflow-docs.css"), DOCS_CSS);
writeFileSync(resolve(publicDir, "picoflow-docs.css"), DOCS_CSS);

function copyDir(src, dst) {
  if (!existsSync(src)) return;
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = resolve(src, name);
    const to = resolve(dst, name);
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}

copyDir(resolve(root, "docs/whitepaper/charts"), resolve(distDir, "charts"));
copyDir(resolve(root, "docs/whitepaper/charts"), resolve(publicDir, "charts"));

for (const dir of [distDir, publicDir]) {
  for (const name of readdirSync(dir)) {
    if (/^picoflow-.*\.(pdf|html|md)$/i.test(name) || name === "index.json") {
      unlinkSync(resolve(dir, name));
    }
  }
}

const PANDOC = findTool("PANDOC_BIN", [
  String.raw`C:\Users\Qubitpage\AppData\Local\Pandoc\pandoc.exe`,
  "pandoc",
]);
const XELATEX = findTool("XELATEX_BIN", [
  String.raw`C:\Users\Qubitpage\AppData\Local\Programs\MiKTeX\miktex\bin\x64\xelatex.exe`,
  "xelatex",
]);
const HAS_PANDOC = Boolean(PANDOC);
const HAS_XELATEX = Boolean(XELATEX);

function findTool(envName, candidates) {
  const envValue = process.env[envName];
  const all = envValue ? [envValue, ...candidates] : candidates;
  for (const cmd of all) {
    if (!cmd) continue;
    if ((cmd.includes("\\") || cmd.includes("/")) && existsSync(cmd)) return cmd;
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], {
      stdio: "ignore",
      shell: true,
    });
    if (r.status === 0) return cmd;
  }
  return null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  return r.status === 0;
}

function readIfExists(p) {
  return existsSync(p) ? normalizeText(readFileSync(p, "utf8")) : `> Source missing: ${p}\n`;
}

function normalizeText(s) {
  return s
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€˜/g, "‘")
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€/g, "”")
    .replace(/Â§/g, "§")
    .replace(/Â·/g, "·")
    .replace(/Â/g, "")
    .replace(/â†’/g, "→")
    .replace(/â‰¥/g, "≥")
    .replace(/â‰¤/g, "≤")
    .replace(/âœ…/g, "✅")
    .replace(/â”œ/g, "├")
    .replace(/â”€/g, "─")
    .replace(/â”‚/g, "│")
    .replace(/â””/g, "└");
}

function stripYamlFrontmatter(md) {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

function stripInternalNarration(md) {
  return md
    .split(/\r?\n/)
    .filter((line) => !/video-script|record video|video script|speech notes/i.test(line))
    .join("\n");
}

function appendix(title, src) {
  return `\n\n---\n\n# Appendix — ${title}\n\n${stripInternalNarration(stripYamlFrontmatter(readIfExists(src)))}`;
}

function conciseDeliveryAppendix() {
  return `\n\n---\n\n# Appendix — Delivery and test report\n\n## Production truth\n\n- Arc Testnet contracts are live and verified: BondVault, ReputationRegistry, and MetadataLogger are linked in the proof section above.\n- Arbitrum One is the live mainnet proof path today, with a real USDC transaction and mainnet contract links.\n- Arc Mainnet is not public yet, so PicoFlow does not claim Arc Mainnet production settlement.\n- Base Mainnet fallback is prepared but unfunded; preflight reports funded = false until ETH gas is sent to the deployer.\n- Featherless and AI/ML API are real upstreams. AIsa has no issued key yet, so the data route uses live Kraken public market data before the deterministic emergency fallback.\n\n## Verified workflows\n\n- Signup and login create a tenant org, issue a signed session, and open the customer account page.\n- Customer API keys can be minted from the web UI, are shown once, and are stored as sha256(secret) only.\n- Paid endpoints accept Bearer-form PicoFlow API keys; /api/whoami proves the key round trip without spending money.\n- Admins can create/disable orgs, mint tenant or admin keys, edit key labels/scopes, revoke keys, and inspect active prefixes without revealing raw secrets.\n- Settings secrets are masked in listings; privileged reveal/edit requires the backend admin token.\n- The demo runner executes the 56-action workflow with network selection and records terminal output for judges.\n\n## Proof links\n\n- Arbitrum One real USDC tx: https://arbiscan.io/tx/0xcacbbfcb3f54f92bb01919810cfd9e5ebecc2b99ddc80bd93afd8681efe94afd\n- Arbitrum One BondVault: https://arbiscan.io/address/0x140A306E5c51C8521827e9be1E5167399dc31c75\n- Arc Testnet faucet tx: https://testnet.arcscan.app/tx/0xba0307bba4d9f330d3b6c1b4579686a9e6048cf18bf272ba1e6db037ec373315\n- Arc Testnet BondVault: https://testnet.arcscan.app/address/0x00792829C3553B95A84bafe33c76E93570D0AbA4\n- Arc Testnet ReputationRegistry: https://testnet.arcscan.app/address/0x8Cf86bA01806452B336369D4a25466c34951A086\n- Arc Testnet MetadataLogger: https://testnet.arcscan.app/address/0x2853EDc8BAa06e7A7422CCda307ED3E7f0E96FA8\n`;
}

function buildUnifiedWhitepaper() {
  const base = readIfExists(resolve(root, "docs/whitepaper/PicoFlow-Whitepaper.md"));
  const sections = [
    ["Operations guide", resolve(root, "docs/product/PicoFlow-Admin-User-Guide.md")],
  ];
  const combined = `${base}\n\n---\n\n# 21. Unified product appendix\n\nThe public docs surface intentionally exposes only two deliverables: this unified whitepaper and the pitch deck. Internal narration notes, duplicate slide outlines, timestamp-heavy build logs, and raw critique transcripts stay out of the public documentation. The appendices below keep only the operating details judges and implementers need.\n${sections
    .map(([title, src]) => appendix(title, src))
    .join("\n")}\n${conciseDeliveryAppendix()}`;
  const out = resolve(distDir, "picoflow-unified-whitepaper-source.md");
  writeFileSync(out, normalizeText(combined));
  return out;
}

const UNIFIED_WHITEPAPER_SRC = buildUnifiedWhitepaper();

/**
 * @typedef {{ slug: string; title: string; src: string; category: string; description: string }} Doc
 */
/** @type {Doc[]} */
const DOCS = [
  {
    slug: "picoflow-whitepaper",
    title: "PicoFlow — Unified Whitepaper v0.4",
    src: UNIFIED_WHITEPAPER_SRC,
    category: "Whitepaper",
    description:
      "Single source of truth: concept, architecture, customer API flow, mainnet/testnet proof, provider stack, testing, operations, and delivery report.",
  },
  {
    slug: "picoflow-pitch-deck",
    title: "PicoFlow — Pitch Deck",
    src: resolve(root, "docs/pitch/PicoFlow-Pitch.md"),
    category: "Pitch Deck",
    description: "Concise investor/judge presentation: problem, insight, live proof, sponsor coverage, economics, and roadmap.",
  },
];

/**
 * Build PDF + HTML for one markdown source.
 */
function buildOne(doc) {
  if (!existsSync(doc.src)) {
    console.warn(`[docs] skip ${doc.slug} — source missing: ${doc.src}`);
    return null;
  }
  const pdf = resolve(distDir, `${doc.slug}.pdf`);
  const html = resolve(distDir, `${doc.slug}.html`);
  const resourcePath = [dirname(doc.src), root, resolve(root, "docs/whitepaper")].join(delimiter);

  // HTML — always works with pandoc, looks clean with --self-contained --css
  if (HAS_PANDOC) {
    run(PANDOC, [
      `"${doc.src}"`,
      "-s",
      "--metadata",
      `title="${doc.title}"`,
      "--resource-path",
      `"${resourcePath}"`,
      "--toc",
      "--toc-depth=2",
      "--css",
      "picoflow-docs.css",
      "-o",
      `"${html}"`,
    ]);
  } else {
    // Fallback: dump <pre> wrapper of the markdown itself
    const md = normalizeText(readFileSync(doc.src, "utf8"));
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><title>${escapeHtml(
        doc.title,
      )}</title><body style="max-width:48rem;margin:2rem auto;font:14px/1.55 system-ui;padding:0 1rem"><h1>${escapeHtml(
        doc.title,
      )}</h1><pre style="white-space:pre-wrap;font:13px/1.55 ui-monospace,Menlo,Consolas,monospace">${escapeHtml(
        md,
      )}</pre>`,
    );
  }

  // PDF
  let pdfOk = false;
  if (HAS_PANDOC && HAS_XELATEX) {
    pdfOk = run(PANDOC, [
      `"${doc.src}"`,
      "-o",
      `"${pdf}"`,
      `--pdf-engine=${XELATEX}`,
      "--resource-path",
      `"${resourcePath}"`,
      "--toc",
      "--toc-depth=2",
      "--metadata",
      `title="${doc.title}"`,
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
    ]);
  }
  if (!pdfOk && HAS_PANDOC) {
    pdfOk = run(PANDOC, [`"${doc.src}"`, "-o", `"${pdf}"`, "--toc", "-M", "keywords="]);
  }
  if (!pdfOk) {
    console.warn(`[docs] PDF generation failed for ${doc.slug} — only HTML available`);
  }

  // Stage to dashboard public/
  if (existsSync(html)) copyFileSync(html, resolve(publicDir, `${doc.slug}.html`));
  if (existsSync(pdf)) copyFileSync(pdf, resolve(publicDir, `${doc.slug}.pdf`));

  return doc;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fileMeta(p) {
  if (!existsSync(p)) return null;
  const s = statSync(p);
  return { bytes: s.size, mtime: s.mtimeMs };
}

console.log(`[docs] pandoc=${HAS_PANDOC} xelatex=${HAS_XELATEX}`);
const built = DOCS.map(buildOne).filter(Boolean);

// Build catalogue
const catalogue = built.map((d) => {
    const pdf = fileMeta(resolve(publicDir, `${d.slug}.pdf`));
    const html = fileMeta(resolve(publicDir, `${d.slug}.html`));
    return {
      slug: d.slug,
      title: d.title,
      category: d.category,
      description: d.description,
      pdf: pdf ? { url: `/docs/${d.slug}.pdf`, bytes: pdf.bytes } : null,
      html: html ? { url: `/docs/${d.slug}.html`, bytes: html.bytes } : null,
      source_md: `/docs/${d.slug}.md`,
    };
  });

for (const d of built) {
  const dst = resolve(publicDir, `${d.slug}.md`);
  copyFileSync(d.src, dst);
}

writeFileSync(
  resolve(publicDir, "index.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), docs: catalogue }, null, 2),
);

console.log(`[docs] ✅ ${catalogue.length} docs catalogued at ${publicDir}\\index.json`);
