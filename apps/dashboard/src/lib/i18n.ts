import { headers } from "next/headers";

export type Locale = "en" | "ro" | "es" | "fr" | "de";
const SUPPORTED: Locale[] = ["en", "ro", "es", "fr", "de"];

/**
 * Locale resolution — DEFAULT IS ENGLISH.
 * Only switches when an explicit `?lang=xx` query param is present in the
 * referer/URL. Browser Accept-Language is intentionally ignored so the
 * hackathon judges always see the canonical English UI.
 */
export async function getLocale(): Promise<Locale> {
  try {
    const h = await headers();
    const url = h.get("x-invoke-path") || h.get("referer") || "";
    const m = url.match(/[?&]lang=([a-z]{2})/i);
    const tag = m?.[1]?.toLowerCase() as Locale | undefined;
    if (tag && SUPPORTED.includes(tag)) return tag;
  } catch { /* ignore */ }
  return "en";
}

const dict: Record<Locale, Record<string, string>> = {
  en: {
    "nav.ledger": "Live ledger", "nav.registry": "Registry", "nav.margin": "Margin",
    "nav.splits": "Splits", "nav.proofmesh": "ProofMesh", "nav.demo": "Demo runner",
    "nav.providers": "Providers", "nav.console": "Console", "nav.track": "Track", "nav.feedback": "Feedback", "nav.docs": "Docs",
    "nav.settings": "Settings",
    "footer.tag": "Built for the lablab.ai · Build the Agentic Economy on Arc using USDC and Nanopayments hackathon.",
    "tagline": "Settlement Mesh on Arc",
  },
  ro: {
    "nav.ledger": "Registru live", "nav.registry": "Registry", "nav.margin": "Marjă",
    "nav.splits": "Distribuții", "nav.proofmesh": "ProofMesh", "nav.demo": "Demo",
    "nav.providers": "Furnizori", "nav.console": "Consolă", "nav.track": "Track", "nav.feedback": "Feedback", "nav.docs": "Docs",
    "nav.settings": "Setări",
    "footer.tag": "Construit pentru hackathon-ul lablab.ai · Build the Agentic Economy on Arc.",
    "tagline": "Settlement Mesh pe Arc",
  },
  es: {
    "nav.ledger": "Libro mayor", "nav.registry": "Registro", "nav.margin": "Margen",
    "nav.splits": "Repartos", "nav.proofmesh": "ProofMesh", "nav.demo": "Demo",
    "nav.providers": "Proveedores", "nav.console": "Consola", "nav.track": "Track", "nav.feedback": "Feedback", "nav.docs": "Docs",
    "nav.settings": "Ajustes",
    "footer.tag": "Hecho para el hackathon lablab.ai · Build the Agentic Economy on Arc.",
    "tagline": "Settlement Mesh en Arc",
  },
  fr: {
    "nav.ledger": "Registre live", "nav.registry": "Registre", "nav.margin": "Marge",
    "nav.splits": "Répartitions", "nav.proofmesh": "ProofMesh", "nav.demo": "Démo",
    "nav.providers": "Fournisseurs", "nav.console": "Console", "nav.track": "Track", "nav.feedback": "Feedback", "nav.docs": "Docs",
    "nav.settings": "Paramètres",
    "footer.tag": "Conçu pour le hackathon lablab.ai · Build the Agentic Economy on Arc.",
    "tagline": "Settlement Mesh sur Arc",
  },
  de: {
    "nav.ledger": "Live-Ledger", "nav.registry": "Registrierung", "nav.margin": "Marge",
    "nav.splits": "Aufteilungen", "nav.proofmesh": "ProofMesh", "nav.demo": "Demo",
    "nav.providers": "Provider", "nav.console": "Konsole", "nav.track": "Track", "nav.feedback": "Feedback", "nav.docs": "Docs",
    "nav.settings": "Einstellungen",
    "footer.tag": "Erstellt für das lablab.ai-Hackathon · Build the Agentic Economy on Arc.",
    "tagline": "Settlement Mesh auf Arc",
  },
};

export function t(locale: Locale, key: string): string {
  return dict[locale][key] ?? dict.en[key] ?? key;
}
