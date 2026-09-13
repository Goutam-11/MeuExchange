import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import sha3 from "js-sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { HederaMirrorClient } from "./mirror.js";

export interface Session { account: string; role: "participant" | "operator"; exp: number }
interface Challenge { accountId: string; message: string; expiresAt: number }

export class WalletAuth {
  private readonly challenges = new Map<string, Challenge>();
  constructor(private readonly secret: string, private readonly mirror: HederaMirrorClient, private readonly origin = "http://localhost", private readonly operatorAccounts = new Set<string>()) {}

  challenge(accountId: string) {
    if (!accountId) throw new Error("accountId is required");
    this.sweep();
    const nonce = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
    const expiresAt = Date.now() + 5 * 60_000;
    const message = `MEU Exchange wants you to sign in:\n${this.origin}\n\nAccount: ${accountId}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
    this.challenges.set(nonce, { accountId, message, expiresAt });
    return { message, nonce, expiresAt };
  }

  async session(accountId: string, nonce: string, signature: string) {
    const challenge = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    if (!challenge || challenge.accountId !== accountId || challenge.expiresAt <= Date.now()) throw new Error("Challenge is missing, expired, or already used");
    const recovered = recoverAddress(challenge.message, signature);
    const resolved = await this.mirror.resolveAccount(recovered);
    if (!resolved.ok || resolved.account !== accountId) throw new Error("Wallet does not control the claimed Hedera account");
    const session: Session = { account: accountId, role: this.operatorAccounts.has(accountId) ? "operator" : "participant", exp: Date.now() + 8 * 60 * 60_000 };
    return { token: this.sign(session), account: session.account, role: session.role, expiresAt: session.exp };
  }

  verify(token: string): Session | undefined {
    try {
      const [payload, signature] = token.split(".");
      if (!payload || !signature || !timingSafeEqual(Buffer.from(signature, "base64url"), Buffer.from(this.mac(payload, "base64url"), "base64url"))) return undefined;
      const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
      return session.exp > Date.now() ? session : undefined;
    } catch { return undefined; }
  }

  private sign(session: Session) { const payload = Buffer.from(JSON.stringify(session)).toString("base64url"); return `${payload}.${this.mac(payload, "base64url")}`; }
  private mac(payload: string, encoding: BufferEncoding) { return createHmac("sha256", this.secret).update(Buffer.from(payload, encoding)).digest("base64url"); }
  private sweep() { const now = Date.now(); for (const [nonce, challenge] of this.challenges) if (challenge.expiresAt <= now) this.challenges.delete(nonce); }
}

function recoverAddress(message: string, signature: string) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Invalid wallet signature");
  const bytes = Buffer.from(signature.slice(2), "hex");
  const recovery = bytes[64] >= 27 ? bytes[64] - 27 : bytes[64];
  if (recovery > 3) throw new Error("Invalid signature recovery byte");
  const prefix = `\x19Ethereum Signed Message:\n${Buffer.byteLength(message, "utf8")}`;
  const hash = Uint8Array.from(Buffer.from(sha3.keccak_256(Buffer.from(`${prefix}${message}`, "utf8")), "hex"));
  const publicKey = secp256k1.Signature.fromCompact(bytes.slice(0, 64)).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false);
  return `0x${sha3.keccak_256(publicKey.slice(1)).slice(-40)}`;
}
