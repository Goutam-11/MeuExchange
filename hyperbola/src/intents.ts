import { createRequire } from "node:module";
import type { CreateBondRequest as CreateBondRequestType, CreateEquityRequest as CreateEquityRequestType, GrantKycRequest as GrantKycRequestType, LockRequest as LockRequestType, ReleaseRequest as ReleaseRequestType, TransferRequest as TransferRequestType } from "@hashgraph/asset-tokenization-sdk";
import { offeredAssetTypes } from "./assets.js";
import { MemoryDocumentStore, type DocumentStore } from "./state.js";

const require = createRequire(import.meta.url);
const { CreateBondRequest, CreateEquityRequest, GrantKycRequest, LockRequest, ReleaseRequest, TransferRequest } = require("@hashgraph/asset-tokenization-sdk") as {
  CreateBondRequest: new (input: ConstructorParameters<typeof CreateBondRequestType>[0]) => CreateBondRequestType;
  CreateEquityRequest: new (input: ConstructorParameters<typeof CreateEquityRequestType>[0]) => CreateEquityRequestType;
  GrantKycRequest: new (input: ConstructorParameters<typeof GrantKycRequestType>[0]) => GrantKycRequestType;
  LockRequest: new (input: ConstructorParameters<typeof LockRequestType>[0]) => LockRequestType;
  ReleaseRequest: new (input: ConstructorParameters<typeof ReleaseRequestType>[0]) => ReleaseRequestType;
  TransferRequest: new (input: ConstructorParameters<typeof TransferRequestType>[0]) => TransferRequestType;
};

export type IntentKind = "createBond" | "createEquity" | "grantKyc" | "lock" | "release" | "transfer";

export interface TransactionIntent {
  id: string;
  kind: IntentKind;
  network: "testnet";
  status: "awaiting_signature" | "signed" | "submitted" | "confirmed" | "failed";
  sdk: "@hashgraph/asset-tokenization-sdk";
  schemaVersion: 2;
  request: Record<string, unknown>;
  createdAt: string;
  signedBy?: string;
  signature?: string;
  transactionId?: string;
  confirmedAt?: string;
}

export class IntentBook {
  private readonly intents = new Map<string, TransactionIntent>();
  constructor(private readonly store: DocumentStore<TransactionIntent[]> = new MemoryDocumentStore()) {
    store.load()?.forEach((intent) => this.intents.set(intent.id, migrateIntent(intent)));
  }

  issue(input: { assetType: string; name: string; symbol: string; isin: string; currency: string; units: string; configId: string; configVersion: number; maturityDate?: string; nominalValue?: string; ownerAccount?: string }) {
    const asset = offeredAssetTypes.find((item) => item.id === input.assetType);
    if (!asset) throw new Error("Unsupported asset type");
    if (!input.name || !input.symbol || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(input.isin) || !input.currency || !/^\d+(\.\d+)?$/.test(input.units) || Number(input.units) <= 0 || !input.configId || !Number.isInteger(input.configVersion)) throw new Error("name, symbol, isin, currency, units, configId, and configVersion are required");
    const request = asset.id === "fixed-income-note" ? bondRequest(input) : equityRequest(input);
    return this.save(asset.id === "fixed-income-note" ? "createBond" : "createEquity", request);
  }

  kyc(tokenId: string, accountId: string, vcData: string) {
    if (!tokenId || !accountId || !vcData) throw new Error("tokenId, accountId, and vcData are required");
    return this.save("grantKyc", serializeRequest(new GrantKycRequest({ securityId: tokenId, targetId: accountId, vcBase64: Buffer.from(vcData, "utf8").toString("base64") })));
  }

  lock(tokenId: string, accountId: string, amount: number, expirationTimestamp: string) {
    if (!tokenId || !accountId || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(Date.parse(expirationTimestamp))) throw new Error("Valid tokenId, accountId, amount, and expirationTimestamp are required");
    return this.save("lock", serializeRequest(new LockRequest({ securityId: tokenId, targetId: accountId, amount: String(amount), expirationTimestamp })));
  }

  release(tokenId: string, accountId: string, lockId: number) {
    if (!tokenId || !accountId || !Number.isInteger(lockId) || lockId < 0) throw new Error("Valid tokenId, accountId, and lockId are required");
    return this.save("release", serializeRequest(new ReleaseRequest({ securityId: tokenId, targetId: accountId, lockId })));
  }

  transfer(tokenId: string, targetId: string, amount: number) {
    if (!tokenId || !targetId || !Number.isFinite(amount) || amount <= 0) throw new Error("Valid tokenId, targetId, and amount are required");
    return this.save("transfer", serializeRequest(new TransferRequest({ securityId: tokenId, targetId, amount: String(amount) })));
  }

  all() { return [...this.intents.values()]; }
  get(id: string) { return this.intents.get(id); }
  sign(id: string, accountId: string, signature: string) {
    const intent = this.must(id);
    if (!accountId || !signature) throw new Error("accountId and signature are required");
    if (intent.status !== "awaiting_signature") throw new Error("Only awaiting_signature intents can be signed");
    const owner = intent.request.diamondOwnerAccount;
    if (typeof owner === "string" && owner && owner !== accountId) throw new Error("Only the intent owner can sign this request");
    intent.status = "signed"; intent.signedBy = accountId; intent.signature = signature; this.persist();
    return intent;
  }
  submit(id: string, transactionId: string) {
    const intent = this.must(id);
    if (!transactionId) throw new Error("transactionId is required");
    if (intent.status !== "signed") throw new Error("Sign the intent before submitting its transaction reference");
    intent.status = "submitted"; intent.transactionId = transactionId; this.persist();
    return intent;
  }
  confirm(id: string, transactionId: string) {
    const intent = this.must(id);
    if (!transactionId) throw new Error("transactionId is required");
    if (intent.status !== "submitted") throw new Error("Submit the transaction reference before confirming it");
    intent.status = "confirmed"; intent.transactionId = transactionId; intent.confirmedAt = new Date().toISOString(); this.persist();
    return intent;
  }
  private save(kind: IntentKind, request: Record<string, unknown>) {
    const intent: TransactionIntent = { id: `intent_${crypto.randomUUID()}`, kind, network: "testnet", status: "awaiting_signature", sdk: "@hashgraph/asset-tokenization-sdk", schemaVersion: 2, request, createdAt: new Date().toISOString() };
    this.intents.set(intent.id, intent);
    this.persist();
    return intent;
  }
  private must(id: string) { const intent = this.intents.get(id); if (!intent) throw new Error("Intent not found"); return intent; }
  private persist() { this.store.save([...this.intents.values()]); }
}

function bondRequest(input: { name: string; symbol: string; isin: string; currency: string; units: string; configId: string; configVersion: number; maturityDate?: string; nominalValue?: string; ownerAccount?: string }) {
  return serializeRequest(new CreateBondRequest({ name: input.name, symbol: input.symbol, isin: input.isin, decimals: 0, isWhiteList: true, erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false, isMultiPartition: false, clearingActive: false, internalKycActivated: true, diamondOwnerAccount: input.ownerAccount, currency: input.currency, numberOfUnits: input.units, nominalValue: input.nominalValue || "100", startingDate: new Date().toISOString(), maturityDate: input.maturityDate || "2030-01-01T00:00:00.000Z", regulationType: 1, regulationSubType: 1, isCountryControlListWhiteList: true, countries: "", info: "Issuer supplied terms required", configId: input.configId, configVersion: input.configVersion }));
}

function equityRequest(input: { name: string; symbol: string; isin: string; currency: string; units: string; configId: string; configVersion: number; ownerAccount?: string }) {
  return serializeRequest(new CreateEquityRequest({ name: input.name, symbol: input.symbol, isin: input.isin, decimals: 0, isWhiteList: true, erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false, isMultiPartition: false, clearingActive: false, internalKycActivated: true, diamondOwnerAccount: input.ownerAccount, votingRight: false, informationRight: true, liquidationRight: false, subscriptionRight: false, conversionRight: false, redemptionRight: true, putRight: false, dividendRight: 0, currency: input.currency, numberOfShares: input.units, nominalValue: "1", regulationType: 1, regulationSubType: 1, isCountryControlListWhiteList: true, countries: "", info: "Issuer supplied fund terms required", configId: input.configId, configVersion: input.configVersion }));
}

function serializeRequest(request: object): Record<string, unknown> {
  const value = JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
  if ("_decimals" in value) { value.decimals = (request as { decimals: number }).decimals; delete value._decimals; }
  delete value.schema;
  return value;
}

function migrateIntent(intent: TransactionIntent): TransactionIntent {
  if (intent.schemaVersion === 2) return intent;
  const request = { ...intent.request };
  if (intent.kind === "grantKyc" && typeof request.tokenId === "string") { request.securityId = request.tokenId; request.vcBase64 = Buffer.from(String(request.vcData || ""), "utf8").toString("base64"); delete request.tokenId; delete request.vcData; }
  if (intent.kind === "transfer" && typeof request.tokenId === "string") { request.securityId = request.tokenId; request.amount = String(request.amount); delete request.tokenId; }
  return { ...intent, schemaVersion: 2, request };
}
