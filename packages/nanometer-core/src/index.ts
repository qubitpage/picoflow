/**
 * @picoflow/nanometer-core — public surface
 */
export * from "./x402.js";
export * from "./ledger.js";
export * from "./gemini.js";
export * from "./buyer.js";
export * from "./registry.js";
export * from "./margin.js";
export * from "./proofmesh.js";

/** Arc Testnet constants (April 2026) */
export const ARC_TESTNET = {
  chainId: 5042002,
  name: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`,
  cctpDomain: 26,
  malachiteFinalityMs: 387,
  typicalTransferUsdc: 0.009,
  gateway: {
    wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
    minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as `0x${string}`,
    apiBase: "https://gateway-api-testnet.circle.com",
  },
} as const;
