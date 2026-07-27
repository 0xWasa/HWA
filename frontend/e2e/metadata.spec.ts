import { expect, test } from "@playwright/test";

test.describe("NFT metadata boundary", () => {
  test("accepts bounded on-chain JSON and sanitizes its display fields", async ({ request }) => {
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const tokenURI = `data:application/json;base64,${Buffer.from(
      JSON.stringify({ name: "  Test\u0000 NFT  ", image }),
    ).toString("base64")}`;
    const response = await request.get(`/api/nft-metadata?uri=${encodeURIComponent(tokenURI)}`);
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ name: "Test NFT", imageUrl: image });
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("refuses an allowlisted literal private destination after host validation", async ({ request }) => {
    const response = await request.get(`/api/nft-metadata?uri=${encodeURIComponent("https://127.0.0.1/private.json")}`);
    expect(response.status()).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "metadata unavailable" });
  });
});
