import { offeredAssetTypes } from "./assets.js";

export type IntentKind = "createBond" | "createEquity" | "grantKyc" | "lock" | "release" | "transfer";

export interface TransactionIntent {
  id: string;
  kind: IntentKind;
  network: "testnet";
  status: "awaiting_signature";
  sdk: "@hashgraph/asset-tokenization-sdk";
  request: Record<string, unknown>;
  createdAt: string;
}

export class IntentBook {
  private readonly intents = new Map<string, TransactionIntent>();

  issue(input: { assetType: string; name: string; symbol: string; isin: string; currency: string; units: string; configId: string; configVersion: number; maturityDate?: string; nominalValue?: string; ownerAccount?: string }) {
    const asset = offeredAssetTypes.find((item) => item.id === input.assetType);
    if (!asset) throw new Error("Unsupported asset type");
    if (!input.name || !input.symbol || !input.isin || !input.currency || !input.units || !input.configId || !Number.isInteger(input.configVersion)) throw new Error("name, symbol, isin, currency, units, configId, and configVersion are required");
    const request = asset.id === "fixed-income-note" ? bondRequest(input) : equityRequest(input);
    return this.save(asset.id === "fixed-income-note" ? "createBond" : "createEquity", request);
  }

  kyc(tokenId: string, accountId: string, vcData: string) {
    if (!tokenId || !accountId || !vcData) throw new Error("tokenId, accountId, and vcData are required");
    return this.save("grantKyc", { tokenId, targetId: accountId, vcData });
  }

  lock(tokenId: string, accountId: string, amount: number, expirationTimestamp: string) {
    if (!tokenId || !accountId || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(Date.parse(expirationTimestamp))) throw new Error("Valid tokenId, accountId, amount, and expirationTimestamp are required");
    return this.save("lock", { securityId: tokenId, targetId: accountId, amount: String(amount), expirationTimestamp });
  }

  release(tokenId: string, accountId: string, lockId: number) {
    if (!tokenId || !accountId || !Number.isInteger(lockId) || lockId < 0) throw new Error("Valid tokenId, accountId, and lockId are required");
    return this.save("release", { securityId: tokenId, targetId: accountId, lockId });
  }

  transfer(tokenId: string, targetId: string, amount: number) {
    if (!tokenId || !targetId || !Number.isFinite(amount) || amount <= 0) throw new Error("Valid tokenId, targetId, and amount are required");
    return this.save("transfer", { tokenId, targetId, amount });
  }

  all() { return [...this.intents.values()]; }
  private save(kind: IntentKind, request: Record<string, unknown>) {
    const intent: TransactionIntent = { id: `intent_${crypto.randomUUID()}`, kind, network: "testnet", status: "awaiting_signature", sdk: "@hashgraph/asset-tokenization-sdk", request, createdAt: new Date().toISOString() };
    this.intents.set(intent.id, intent);
    return intent;
  }
}

function bondRequest(input: { name: string; symbol: string; isin: string; currency: string; units: string; configId: string; configVersion: number; maturityDate?: string; nominalValue?: string; ownerAccount?: string }) {
  return { name: input.name, symbol: input.symbol, isin: input.isin, decimals: 0, isWhiteList: true, erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false, isMultiPartition: false, clearingActive: false, internalKycActivated: true, diamondOwnerAccount: input.ownerAccount, currency: input.currency, numberOfUnits: input.units, nominalValue: input.nominalValue || "100", startingDate: new Date().toISOString(), maturityDate: input.maturityDate || "2030-01-01T00:00:00.000Z", regulationType: 1, regulationSubType: 1, isCountryControlListWhiteList: true, countries: "", info: "Issuer supplied terms required", configId: input.configId, configVersion: input.configVersion };
}

function equityRequest(input: { name: string; symbol: string; isin: string; currency: string; units: string; configId: string; configVersion: number; ownerAccount?: string }) {
  return { name: input.name, symbol: input.symbol, isin: input.isin, decimals: 0, isWhiteList: true, erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false, isMultiPartition: false, clearingActive: false, internalKycActivated: true, diamondOwnerAccount: input.ownerAccount, votingRight: false, informationRight: true, liquidationRight: false, subscriptionRight: false, conversionRight: false, redemptionRight: true, putRight: false, dividendRight: 0, currency: input.currency, numberOfShares: input.units, nominalValue: "1", regulationType: 1, regulationSubType: 1, isCountryControlListWhiteList: true, countries: "", info: "Issuer supplied fund terms required", configId: input.configId, configVersion: input.configVersion };
}
