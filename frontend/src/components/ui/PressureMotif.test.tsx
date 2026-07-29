import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PressureMotif } from "./PressureMotif";

describe("PressureMotif", () => {
  it("is decorative-only and deterministic", () => {
    const a = renderToStaticMarkup(<PressureMotif tone="amber" wallLabel="LAUNCH WALL" />);
    const b = renderToStaticMarkup(<PressureMotif tone="amber" wallLabel="LAUNCH WALL" />);
    expect(a).toBe(b); // same constants → byte-identical geometry
    expect(a).toContain('aria-hidden="true"');
    // Six contour rings plus the core dot pair; no text besides the wall label.
    expect(a.match(/<path /g)?.length).toBe(6);
    expect(a).toContain("LAUNCH WALL");
  });

  it("omits the wall when disabled", () => {
    const svg = renderToStaticMarkup(<PressureMotif wall={false} />);
    expect(svg).not.toContain("<line");
    expect(svg).not.toContain("<text");
  });
});
