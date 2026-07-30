/** Keep transport failures actionable without dumping raw RPC bodies into the UI. */
export function conciseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  if (lower.includes("rate limit") || lower.includes("429")) {
    return "The HyperEVM RPC is rate-limited. Try again in a moment";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The HyperEVM RPC timed out. Your funds are unaffected";
  }
  if (lower.includes("network") || lower.includes("failed to fetch")) {
    return "The HyperEVM RPC could not be reached";
  }

  const firstLine = message.split(/\r?\n/)[0]?.trim();
  if (!firstLine) return "The RPC did not return a quote";
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine;
}
