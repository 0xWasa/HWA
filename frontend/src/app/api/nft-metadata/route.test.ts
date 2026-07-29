import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { isPrivateAddress, metadataRateLimit, trustedClientKey } from "./route";

const originalTrustedHeader = process.env.NFT_METADATA_TRUSTED_CLIENT_IP_HEADER;
const originalRateLimit = process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE;

afterEach(() => {
  if (originalTrustedHeader === undefined) delete process.env.NFT_METADATA_TRUSTED_CLIENT_IP_HEADER;
  else process.env.NFT_METADATA_TRUSTED_CLIENT_IP_HEADER = originalTrustedHeader;
  if (originalRateLimit === undefined) delete process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE;
  else process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE = originalRateLimit;
});

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

describe("NFT metadata production throttling", () => {
  it("uses the Nginx-overwritten real client address when explicitly trusted", () => {
    process.env.NFT_METADATA_TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
    const request = new NextRequest("https://hwa.fun/api/nft-metadata", {
      headers: { "x-real-ip": "203.0.113.42" },
    });
    expect(trustedClientKey(request)).toBe("203.0.113.42");
  });

  it("bounds an operator-configured per-client rate", () => {
    process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE = "600";
    expect(metadataRateLimit()).toBe(600);
    process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE = "999999";
    expect(metadataRateLimit()).toBe(5_000);
    process.env.NFT_METADATA_RATE_LIMIT_PER_MINUTE = "invalid";
    expect(metadataRateLimit()).toBe(60);
  });
});
