import { describe, expect, it } from "vitest";
import { conciseError } from "./errors";

describe("conciseError", () => {
  it("turns a rate-limited RPC dump into actionable copy", () => {
    const error = new Error('Request exceeds defined limit. URL: https://rpc.example Request body: {"method":"eth_call"}\nDetails: rate limited');
    expect(conciseError(error)).toBe("The testnet RPC is rate-limited. Try again in a moment");
  });

  it("never lets an unknown transport message take over the layout", () => {
    expect(conciseError(new Error("x".repeat(300))).length).toBeLessThanOrEqual(140);
  });
});
