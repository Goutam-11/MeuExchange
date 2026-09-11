import type { ChainGateway, RepoAgreement, Trade } from "./domain.js";

/** ATS adapter. MEU Exchange never holds participant or issuer signing keys. */
export class AtsGateway implements ChainGateway {
  private initialized = false;
  constructor(private readonly mode: "demo" | "testnet") {}

  async grantKyc(tokenId: string, accountId: string, vcData: string) {
    if (this.mode === "demo") return this.reference("kyc");
    const ats = await this.sdk();
    this.requireExternalSigner();
    await ats.Kyc.grantKyc(new ats.GrantKycRequest({ tokenId, targetId: accountId, vcData }));
    return this.reference("kyc");
  }

  async lockCollateral(repo: Pick<RepoAgreement, "tokenId" | "borrower" | "collateralAmount" | "maturityAt">) {
    if (this.mode === "demo") return this.reference("lock");
    // ATS exposes Lock.lock through its LockFacet. Signing is delegated to the
    // participant's wallet/custodian; this API never accepts their key.
    await this.sdk();
    this.requireExternalSigner();
    throw new Error(`Submit ATS Lock.lock for ${repo.tokenId} through the borrower's wallet/custodian, then confirm the transaction through this API`);
  }

  async releaseCollateral(repo: RepoAgreement) {
    if (this.mode === "demo") return this.reference("release");
    await this.sdk();
    this.requireExternalSigner();
    throw new Error(`Submit ATS Lock.release for ${repo.tokenId} through the authorized wallet/custodian, then confirm the transaction through this API`);
  }

  async settleTrade(trade: Trade) {
    if (this.mode === "demo") return this.reference("trade");
    const ats = await this.sdk();
    this.requireExternalSigner();
    await ats.Security.transfer(new ats.TransferRequest({ tokenId: trade.tokenId, targetId: trade.buyer, amount: trade.quantity }));
    return this.reference("trade");
  }

  private async sdk(): Promise<any> {
    const ats = await import("@hashgraph/asset-tokenization-sdk");
    if (!this.initialized) {
      const env = process.env;
      const resolverAddress = env.ATS_RESOLVER_ADDRESS;
      const factoryAddress = env.ATS_FACTORY_ADDRESS;
      if (!resolverAddress) throw new Error("ATS_RESOLVER_ADDRESS is required in MODE=testnet");
      if (!factoryAddress) throw new Error("ATS_FACTORY_ADDRESS is required in MODE=testnet");
      await ats.Network.init(new ats.InitializationRequest({
        network: "testnet",
        mirrorNode: { baseUrl: env.HEDERA_MIRROR_NODE || "https://testnet.mirrornode.hedera.com/api/v1/", apiKey: "", headerName: "" },
        rpcNode: { baseUrl: env.HEDERA_RPC_NODE || "https://testnet.hashio.io/api", apiKey: "", headerName: "" },
        configuration: { resolverAddress, factoryAddress }
      }));
      this.initialized = true;
    }
    return ats;
  }

  private reference(action: string) { return `demo-${action}-${crypto.randomUUID()}`; }
  private requireExternalSigner(): never { throw new Error("MEU Exchange does not custody keys. Connect an ATS-compatible wallet or custody signer to submit this transaction."); }
}
