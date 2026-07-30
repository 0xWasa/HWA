import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { POST, isPrivateAddress, metadataRateLimit, trustedClientKey } from "./route";

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

describe("NFT metadata on-chain SVG support", () => {
  it("accepts a large inline JSON token URI with passive base64 SVG artwork", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#83cff1"/>${" ".repeat(5_000)}</svg>`;
    const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const tokenURI = `data:application/json;base64,${Buffer.from(JSON.stringify({ name: "Tiny Hyper Cat #780", image: imageUrl })).toString("base64")}`;
    expect(tokenURI.length).toBeGreaterThan(4_096);

    const response = await POST(
      new NextRequest("https://hwa.fun/api/nft-metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uri: tokenURI }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ name: "Tiny Hyper Cat #780", imageUrl });
  });

  it("rejects active content in an inline SVG image", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    const image = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const tokenURI = `data:application/json;base64,${Buffer.from(JSON.stringify({ image })).toString("base64")}`;

    const response = await POST(
      new NextRequest("https://hwa.fun/api/nft-metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uri: tokenURI }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({});
  });
});
