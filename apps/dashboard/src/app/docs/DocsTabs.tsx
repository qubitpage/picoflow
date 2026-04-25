"use client";

import { useMemo, useState } from "react";

type DocEntry = {
  slug: string;
  title: string;
  category: string;
  description: string;
  pdf: { url: string; bytes: number } | null;
  html: { url: string; bytes: number } | null;
  source_md: string | null;
};

type Props = {
  docs: DocEntry[];
};

const CATEGORY_ORDER = [
  "Operations Guide",
  "Whitepaper",
  "Submission",
  "Reports",
  "Product Readiness",
];

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

export function DocsTabs({ docs }: Props) {
  const categories = useMemo(
    () =>
      Array.from(new Set(docs.map((d) => d.category))).sort(
        (a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b),
      ),
    [docs],
  );
  const [active, setActive] = useState(categories[0] ?? "All");
  const activeDocs = active === "All" ? docs : docs.filter((d) => d.category === active);
  const whitepaper = docs.find((d) => d.slug === "picoflow-whitepaper") ?? docs[0] ?? null;
  const pitch = docs.find((d) => d.slug === "picoflow-pitch-deck") ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-ink/10 pb-3" role="tablist" aria-label="Documentation sections">
        {["All", ...categories].map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={active === category}
            onClick={() => setActive(category)}
            className={
              "rounded-full border px-3 py-1.5 text-sm font-semibold transition " +
              (active === category
                ? "bg-indigo text-cream border-indigo shadow-sm"
                : "border-ink/15 bg-cream text-ink/70 hover:bg-ink/5")
            }
          >
            {category}
            <span className="ml-2 opacity-70 text-xs">
              {category === "All" ? docs.length : docs.filter((d) => d.category === category).length}
            </span>
          </button>
        ))}
      </div>

      <section className="grid lg:grid-cols-2 gap-4">
        {whitepaper ? (
          <article className="card bg-gradient-to-br from-cream to-indigo/5">
            <div className="text-[11px] uppercase tracking-wider text-indigo font-semibold">Primary deliverable</div>
            <h2 className="text-2xl font-semibold mt-1">Unified Whitepaper</h2>
            <p className="text-sm text-ink/70 mt-2 leading-relaxed">
              One document now contains the concept, architecture, network comparison, provider stack, testing report, operations guide, hard critique, Circle feedback, README, pitch outline, and video script.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {whitepaper.html ? <a href={whitepaper.html.url} className="btn btn-primary" target="_blank" rel="noreferrer">Open HTML</a> : null}
              {whitepaper.pdf ? <a href={whitepaper.pdf.url} className="btn" download>Download PDF</a> : null}
              {whitepaper.source_md ? <a href={whitepaper.source_md} className="btn" download>Markdown</a> : null}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
              {["Architecture", "Networks", "Testing", "Operations", "Critique", "Submission"].map((item) => (
                <span key={item} className="rounded-lg border border-ink/10 bg-cream px-3 py-2 font-semibold text-ink/70">{item}</span>
              ))}
            </div>
          </article>
        ) : null}
        {pitch ? (
          <article className="card">
            <div className="text-[11px] uppercase tracking-wider text-indigo font-semibold">Presentation deliverable</div>
            <h2 className="text-2xl font-semibold mt-1">Pitch Deck</h2>
            <p className="text-sm text-ink/70 mt-2 leading-relaxed">
              The short judge/investor narrative: problem, insight, Arbitrum real-funds proof, Arc Testnet readiness, provider economics, sponsor coverage, trust layer, and roadmap.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {pitch.html ? <a href={pitch.html.url} className="btn btn-primary" target="_blank" rel="noreferrer">Open HTML</a> : null}
              {pitch.pdf ? <a href={pitch.pdf.url} className="btn" download>Download PDF</a> : null}
              {pitch.source_md ? <a href={pitch.source_md} className="btn" download>Markdown</a> : null}
            </div>
          </article>
        ) : null}
      </section>

      <section className="grid md:grid-cols-2 gap-4" role="tabpanel">
        {activeDocs.map((d) => (
          <article key={d.slug} className="card flex flex-col">
            <div className="text-[11px] uppercase tracking-wider text-ink/45 font-semibold">{d.category}</div>
            <div className="font-semibold mt-1">{d.title}</div>
            <p className="text-sm text-ink/70 mt-1 mb-4 flex-1 leading-relaxed">{d.description}</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {d.pdf && (
                <a href={d.pdf.url} className="inline-flex items-center gap-1 rounded bg-indigo text-white px-3 py-1.5 hover:bg-indigo/90" download>
                  PDF <span className="text-xs opacity-70">({fmtBytes(d.pdf.bytes)})</span>
                </a>
              )}
              {d.html && (
                <a href={d.html.url} className="inline-flex items-center gap-1 rounded border border-ink/20 px-3 py-1.5 hover:bg-ink/5" target="_blank" rel="noreferrer">
                  HTML <span className="text-xs opacity-70">({fmtBytes(d.html.bytes)})</span>
                </a>
              )}
              {d.source_md && (
                <a href={d.source_md} className="inline-flex items-center gap-1 rounded border border-ink/20 px-3 py-1.5 hover:bg-ink/5 font-mono text-xs" download>
                  Markdown
                </a>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
