import { describe, expect, it } from "vitest";

import { isPrivateAddress } from "./route";

describe("NFT metadata destination classification", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.0.2.1",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::127.0.0.1",
    "64:ff9b:1::a9fe:a9fe",
    "2002:7f00:0001::",
    "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
    "2001:db8::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "accepts public address %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});
