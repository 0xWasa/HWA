export type ProtocolErrorCode =
  | "WALLET_NOT_CONNECTED"
  | "WRONG_NETWORK"
  | "WRITES_DISABLED" // manifest absent/invalid — read-only mode
  | "ACQUISITIONS_DISABLED"
  | "INSUFFICIENT_BALANCE"
  | "QUOTE_STALE"
  | "PRICE_DRIFTED" // live fee above the guarded max
  | "COLLECTION_NOT_WHITELISTED"
  | "BELOW_MIN_BACKING"
  | "NOT_ELIGIBLE" // wrong role / wrong window for a settlement action
  | "WINDOW_NOT_OPEN"
  | "USER_REJECTED"
  | "REVERTED"
  | "RPC_DOWN"
  | "INDEXER_DOWN"
  | "CONTRACT_MISCONFIGURED"
  | "UNKNOWN";

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  /** Raw revert data / provider message, surfaced behind a details toggle. */
  readonly raw?: string;

  constructor(code: ProtocolErrorCode, message: string, raw?: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
    this.raw = raw;
  }
}

/** Actionable, user-facing description for every failure mode. */
export function describeError(err: unknown): { title: string; detail?: string; raw?: string } {
  if (err instanceof ProtocolError) {
    switch (err.code) {
      case "WALLET_NOT_CONNECTED":
        return { title: "Connect a wallet to continue" };
      case "WRONG_NETWORK":
        return { title: "Wrong network", detail: err.message };
      case "WRITES_DISABLED":
        return {
          title: "Writes are disabled",
          detail: "The deployment manifest disables risk-increasing writes. Emergency exits and claims remain available.",
        };
      case "ACQUISITIONS_DISABLED":
        return { title: "Acquisitions are not open", detail: "The protocol has acquisitions disabled right now." };
      case "INSUFFICIENT_BALANCE":
        return { title: "Insufficient HYPE balance", detail: err.message };
      case "QUOTE_STALE":
        return { title: "Quote expired", detail: "The price was re-checked and changed. Review the new quote." };
      case "PRICE_DRIFTED":
        return { title: "Price moved beyond your tolerance", detail: err.message };
      case "COLLECTION_NOT_WHITELISTED":
        return { title: "Collection not allowed", detail: "This collection is not on the current allowlist." };
      case "BELOW_MIN_BACKING":
        return { title: "Backing below minimum", detail: err.message };
      case "NOT_ELIGIBLE":
        return { title: "Action not available", detail: err.message };
      case "WINDOW_NOT_OPEN":
        return { title: "Window not open yet", detail: err.message };
      case "USER_REJECTED":
        return { title: "Rejected in wallet" };
      case "REVERTED":
        return { title: "Transaction reverted", detail: err.message, raw: err.raw };
      case "RPC_DOWN":
        return {
          title: "RPC or receipt timeout",
          detail: err.message || "Check the explorer before retrying because the transaction outcome may be unknown.",
          raw: err.raw,
        };
      case "INDEXER_DOWN":
        return { title: "Indexer unavailable", detail: "On-chain views remain available." };
      case "CONTRACT_MISCONFIGURED":
        return { title: "Contract configuration mismatch", detail: err.message, raw: err.raw };
      default:
        return { title: "Something failed", detail: err.message, raw: err.raw };
    }
  }
  if (err instanceof Error) return { title: "Something failed", detail: err.message };
  return { title: "Something failed" };
}
