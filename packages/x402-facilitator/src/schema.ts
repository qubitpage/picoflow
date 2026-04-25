import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolves to the absolute path of the JSON Schema file shipped with this package. */
export function paymentRequiredSchemaPath(): string {
  return join(__dirname, "..", "schema", "payment-required.schema.json");
}

export function signedPaymentSchemaPath(): string {
  return join(__dirname, "..", "schema", "signed-payment.schema.json");
}

export const paymentRequiredSchema = JSON.parse(
  readFileSync(paymentRequiredSchemaPath(), "utf-8"),
) as Record<string, unknown>;

export const signedPaymentSchema = JSON.parse(
  readFileSync(signedPaymentSchemaPath(), "utf-8"),
) as Record<string, unknown>;
