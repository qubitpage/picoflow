import type { Address } from "viem";

/** Circle Arc Testnet constants. */
export const ARC_TESTNET = {
  chainId: 5_042_002,
  rpc: "https://rpc.testnet.arc.network",
  /** USDC and gas token are the same address on Arc. */
  usdc: "0x3600000000000000000000000000000000000000" as Address,
  gateway: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address,
  explorer: "https://testnet.arcscan.app",
  faucet: "https://faucet.circle.com",
} as const;

/**
 * Arbitrum One mainnet constants — production rehearsal target while Arc
 * mainnet is not yet live. Uses Circle native USDC (NOT USDC.e), gas paid in
 * ETH. Sources:
 *   Arbitrum: https://docs.arbitrum.io/build-decentralized-apps/reference/node-providers
 *   USDC:     https://developers.circle.com/stablecoins/usdc-on-main-networks
 */
export const ARBITRUM_MAINNET = {
  chainId: 42_161,
  rpc: "https://arb1.arbitrum.io/rpc",
  usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address,
  /** Circle CCTP TokenMessenger v2 on Arbitrum One (gateway / batcher). */
  gateway: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address,
  explorer: "https://arbiscan.io",
  faucet: null,
} as const;

/**
 * Resolve runtime chain config from env vars. Lets the SAME server binary
 * target Arc Testnet, Arbitrum One, or (future) Arc Mainnet without rebuild.
 *
 * Env contract:
 *   ARC_RPC              RPC endpoint (alias: ARC_RPC_URL)
 *   ARC_CHAIN_ID         decimal chain id
 *   ARC_USDC_ADDR        ERC-20 USDC contract (alias: USDC_ADDRESS)
 *   ARC_GATEWAY_ADDR     CCTP gateway / batcher (optional)
 *   ARC_EXPLORER         block explorer base URL
 *   ARC_NETWORK_NAME     human label (e.g. "Arbitrum One")
 *   ARC_NATIVE_SYMBOL    gas asset symbol (default: "ETH")
 */
export function resolveChainFromEnv(env: NodeJS.ProcessEnv = process.env): {
  chainId: number;
  rpc: string;
  usdc: Address;
  gateway: Address | null;
  explorer: string;
  networkName: string;
  nativeSymbol: string;
} {
  const chainId = Number(env.ARC_CHAIN_ID ?? ARC_TESTNET.chainId);
  let preset: { rpc: string; usdc: Address; gateway: Address | null; explorer: string; name: string; native: string };
  if (chainId === ARBITRUM_MAINNET.chainId) {
    preset = { rpc: ARBITRUM_MAINNET.rpc, usdc: ARBITRUM_MAINNET.usdc, gateway: ARBITRUM_MAINNET.gateway, explorer: ARBITRUM_MAINNET.explorer, name: "Arbitrum One", native: "ETH" };
  } else {
    preset = { rpc: ARC_TESTNET.rpc, usdc: ARC_TESTNET.usdc, gateway: ARC_TESTNET.gateway, explorer: ARC_TESTNET.explorer, name: "Arc Testnet", native: "USDC" };
  }
  return {
    chainId,
    rpc: env.ARC_RPC ?? env.ARC_RPC_URL ?? preset.rpc,
    usdc: ((env.ARC_USDC_ADDR ?? env.USDC_ADDRESS ?? preset.usdc) as Address),
    gateway: (env.ARC_GATEWAY_ADDR as Address | undefined) ?? preset.gateway,
    explorer: env.ARC_EXPLORER ?? preset.explorer,
    networkName: env.ARC_NETWORK_NAME ?? preset.name,
    nativeSymbol: env.ARC_NATIVE_SYMBOL ?? preset.native,
  };
}

/**
 * Multi-chain preset registry. Each entry advertises a chain PicoFlow can
 * settle on once its env points at that chain. The platform is intentionally
 * chain-agnostic: an admin or a future runtime selector picks one by setting
 * ARC_* env vars to the preset values; the server binary itself is unchanged.
 *
 * USDC addresses are Circle-native (NOT bridged USDC.e variants). Sources:
 *   https://developers.circle.com/stablecoins/usdc-on-main-networks
 *   https://developers.circle.com/stablecoins/usdc-on-test-networks
 */
export interface ChainPreset {
  id: string;            // stable slug used by UI selector
  chainId: number;
  name: string;          // human label
  isMainnet: boolean;
  rpc: string;
  usdc: Address;
  gateway: Address | null;
  explorer: string;
  faucet: string | null;
  nativeSymbol: string;
  /** True if PicoFlow contracts (BondVault, Reputation, Metadata) have been deployed here. */
  contractsDeployed: boolean;
}

export const CHAIN_PRESETS: Record<string, ChainPreset> = {
  "arc-testnet": {
    id: "arc-testnet",
    chainId: ARC_TESTNET.chainId,
    name: "Arc Testnet",
    isMainnet: false,
    rpc: ARC_TESTNET.rpc,
    usdc: ARC_TESTNET.usdc,
    gateway: ARC_TESTNET.gateway,
    explorer: ARC_TESTNET.explorer,
    faucet: ARC_TESTNET.faucet,
    nativeSymbol: "USDC",
    contractsDeployed: true,
  },
  "arbitrum-mainnet": {
    id: "arbitrum-mainnet",
    chainId: ARBITRUM_MAINNET.chainId,
    name: "Arbitrum One",
    isMainnet: true,
    rpc: ARBITRUM_MAINNET.rpc,
    usdc: ARBITRUM_MAINNET.usdc,
    gateway: ARBITRUM_MAINNET.gateway,
    explorer: ARBITRUM_MAINNET.explorer,
    faucet: null,
    nativeSymbol: "ETH",
    contractsDeployed: true,
  },
  "arbitrum-sepolia": {
    id: "arbitrum-sepolia",
    chainId: 421_614,
    name: "Arbitrum Sepolia",
    isMainnet: false,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address,
    gateway: null,
    explorer: "https://sepolia.arbiscan.io",
    faucet: "https://faucet.circle.com",
    nativeSymbol: "ETH",
    contractsDeployed: false,
  },
  "base-mainnet": {
    id: "base-mainnet",
    chainId: 8_453,
    name: "Base",
    isMainnet: true,
    rpc: "https://mainnet.base.org",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    gateway: null,
    explorer: "https://basescan.org",
    faucet: null,
    nativeSymbol: "ETH",
    contractsDeployed: false,
  },
  "base-sepolia": {
    id: "base-sepolia",
    chainId: 84_532,
    name: "Base Sepolia",
    isMainnet: false,
    rpc: "https://sepolia.base.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
    gateway: null,
    explorer: "https://sepolia.basescan.org",
    faucet: "https://faucet.circle.com",
    nativeSymbol: "ETH",
    contractsDeployed: false,
  },
  "optimism-mainnet": {
    id: "optimism-mainnet",
    chainId: 10,
    name: "OP Mainnet",
    isMainnet: true,
    rpc: "https://mainnet.optimism.io",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Address,
    gateway: null,
    explorer: "https://optimistic.etherscan.io",
    faucet: null,
    nativeSymbol: "ETH",
    contractsDeployed: false,
  },
  "polygon-mainnet": {
    id: "polygon-mainnet",
    chainId: 137,
    name: "Polygon PoS",
    isMainnet: true,
    rpc: "https://polygon-rpc.com",
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Address,
    gateway: null,
    explorer: "https://polygonscan.com",
    faucet: null,
    nativeSymbol: "MATIC",
    contractsDeployed: false,
  },
  "ethereum-mainnet": {
    id: "ethereum-mainnet",
    chainId: 1,
    name: "Ethereum",
    isMainnet: true,
    rpc: "https://eth.llamarpc.com",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    gateway: null,
    explorer: "https://etherscan.io",
    faucet: null,
    nativeSymbol: "ETH",
    contractsDeployed: false,
  },
};

/** Look up a preset by chainId; returns null if no built-in preset is known. */
export function presetByChainId(chainId: number): ChainPreset | null {
  for (const p of Object.values(CHAIN_PRESETS)) if (p.chainId === chainId) return p;
  return null;
}

/** USDC has 6 decimals on Arc and on every Circle USDC deployment. */
export const USDC_DECIMALS = 6;

/** Default validity window for a 402 challenge — short, to bound replay risk. */
export const DEFAULT_QUOTE_WINDOW_SEC = 300;

/** EIP-3009 typed-data structure for transferWithAuthorization. */
export const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
