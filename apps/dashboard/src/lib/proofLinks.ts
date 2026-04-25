export const EXPLORERS: Record<number, string> = {
  42161: "https://arbiscan.io",
  5042002: "https://testnet.arcscan.app",
};

export const REAL_PROOFS = {
  mainnet: {
    chainId: 42161,
    name: "Arbitrum One",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    latestTx: "0xcacbbfcb3f54f92bb01919810cfd9e5ebecc2b99ddc80bd93afd8681efe94afd",
    buyerTx: "0x95e8960f5a9fe018167a77a782b12b9ec00ba39c6083ce623b00bc930ce5afcf",
    contracts: {
      bondVault: "0x140A306E5c51C8521827e9be1E5167399dc31c75",
      reputation: "0x6BCFa75Cf8E1B01828F69625cD0ba6E50237B390",
      metadata: "0xc10e0B31A9dE86c15298047742594163fb0D20Cd",
    },
  },
  arcTestnet: {
    chainId: 5042002,
    name: "Arc Testnet",
    usdc: "0x3600000000000000000000000000000000000000",
    deployer: "0x5257613C0a0b87405d08B21c62Be3F65CbD0a5bF",
    faucetTx: "0xba0307bba4d9f330d3b6c1b4579686a9e6048cf18bf272ba1e6db037ec373315",
    contracts: {
      bondVault: "0x00792829C3553B95A84bafe33c76E93570D0AbA4",
      reputation: "0x8Cf86bA01806452B336369D4a25466c34951A086",
      metadata: "0x2853EDc8BAa06e7A7422CCda307ED3E7f0E96FA8",
    },
  },
} as const;

export function explorerForChain(chainId: number): string {
  return EXPLORERS[chainId] ?? "https://arbiscan.io";
}

export function txLink(chainId: number, txHash: string): string {
  return `${explorerForChain(chainId)}/tx/${txHash}`;
}

export function addressLink(chainId: number, address: string): string {
  return `${explorerForChain(chainId)}/address/${address}`;
}

export function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function isTxHash(value: string | null | undefined): value is string {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

export function isAddress(value: string | null | undefined): value is string {
  return /^0x[0-9a-fA-F]{40}$/.test(value ?? "");
}
