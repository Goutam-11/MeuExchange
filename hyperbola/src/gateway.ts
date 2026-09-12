import type { ChainGateway, RepoAgreement, Trade } from "./domain.js";

/** ATS adapter. MEU Exchange never holds participant or issuer signing keys. */
export class AtsGateway implements ChainGateway {
  constructor(private readonly mode: "demo" | "testnet") {}

  async grantKyc(tokenId: string, accountId: string, vcData: string) {
    if (this.mode === "demo") return this.reference("kyc");
    throw this.signerRequired(`ATS KYC grant for ${tokenId}/${accountId}`);
  }

  async lockCollateral(repo: Pick<RepoAgreement, "tokenId" | "borrower" | "collateralAmount" | "maturityAt">) {
    if (this.mode === "demo") return this.reference("lock");
    // ATS exposes Lock.lock through its LockFacet. Signing is delegated to the
    // participant's wallet/custodian; this API never accepts their key.
    throw this.signerRequired(`ATS Lock.lock for ${repo.tokenId}`);
  }

  async releaseCollateral(repo: RepoAgreement) {
    if (this.mode === "demo") return this.reference("release");
    throw this.signerRequired(`ATS Lock.release for ${repo.tokenId}`);
  }

  async settleTrade(trade: Trade) {
    if (this.mode === "demo") return this.reference("trade");
    throw this.signerRequired(`ATS transfer settlement for ${trade.tokenId}`);
  }

  private reference(action: string) { return `demo-${action}-${crypto.randomUUID()}`; }
  private signerRequired(operation: string): Error { return new Error(`${operation} is prepared but not submitted: connect an external ATS-compatible signer and confirm its Hedera transaction through the intent API`); }
}
