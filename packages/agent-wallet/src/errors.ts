export type AgentWalletErrorCode =
  | "MISSING_PRIVATE_KEY"
  | "INVALID_CHALLENGE"
  | "INSUFFICIENT_BALANCE"
  | "QUOTE_REJECTED"
  | "SIGN_FAILED"
  | "PAYMENT_RETRY_FAILED"
  | "RPC_FAILED"
  | "NETWORK_ERROR";

/** Typed, structured failure surface — every error path raises this class. */
export class AgentWalletError extends Error {
  readonly code: AgentWalletErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: AgentWalletErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AgentWalletError";
    this.code = code;
    this.details = details;
  }
}
