// Copy the templates/ directory next to dist/ so the published tarball ships them.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const src = resolve(root, "templates");
const dst = resolve(root, "dist", "..", "templates");

if (!existsSync(src)) {
  console.error(`templates dir not found: ${src}`);
  process.exit(0); // not fatal in a fresh checkout
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`copied templates → ${dst}`);
