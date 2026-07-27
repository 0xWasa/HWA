"use client";

import { useState } from "react";
import { isDev, isMockMode } from "@/config/env";
import { useProtocol } from "@/protocol/provider";
import { SCENARIOS, setScenario, type ScenarioId } from "@/protocol/mock/scenarios";

/**
 * Local-only scenario switcher. Rendered exclusively in development builds
 * running in mock mode — never in testnet/mainnet bundles.
 */
export function DevPanel() {
  const { engine, scenario } = useProtocol();
  const [open, setOpen] = useState(false);
  const [reject, setReject] = useState(false);
  const [revert, setRevert] = useState(false);

  if (!isDev || !isMockMode || !engine) return null;

  return (
    // Sits above the mobile acquire bar and clear of the Next dev-tools badge.
    <div className="fixed bottom-16 left-3 z-50 lg:bottom-12">
      {open && (
        <div
          className="anim-fade-up mb-2 w-72 rounded-md border border-line bg-elevated p-3"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs font-semibold uppercase tracking-wide text-mute">Mock scenarios</span>
            <span className="text-2xs text-faint">dev only</span>
          </div>
          <div className="mb-3 grid max-h-64 grid-cols-1 gap-1 overflow-y-auto pr-1">
            {(Object.keys(SCENARIOS) as ScenarioId[]).map((id) => {
              const sc = SCENARIOS[id];
              const active = scenario?.id === id;
              return (
                <button
                  key={id}
                  onClick={() => setScenario(id)}
                  title={sc.description}
                  className={`rounded-sm border px-2 py-1.5 text-left text-2xs transition-colors ${
                    active
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-line bg-control text-dim hover:border-line-strong hover:text-ink"
                  }`}
                >
                  <div className="font-medium">{sc.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-faint">{sc.description}</div>
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5 border-t border-line-subtle pt-2">
            <label className="flex cursor-pointer items-center gap-2 text-2xs text-dim">
              <input
                type="checkbox"
                checked={reject}
                onChange={(e) => {
                  setReject(e.target.checked);
                  engine.setDevFlag("rejectNextWallet", e.target.checked);
                }}
                className="accent-(--color-accent)"
              />
              Reject next wallet prompt
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-2xs text-dim">
              <input
                type="checkbox"
                checked={revert}
                onChange={(e) => {
                  setRevert(e.target.checked);
                  engine.setDevFlag("revertNextTx", e.target.checked);
                }}
                className="accent-(--color-accent)"
              />
              Revert next transaction
            </label>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="dev-panel-toggle"
        className={`flex h-7 items-center gap-1.5 rounded-sm border px-2 text-2xs font-semibold uppercase tracking-wide ${
          open ? "border-accent/50 bg-accent/10 text-accent" : "border-line bg-elevated text-mute hover:text-dim"
        }`}
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        <span aria-hidden className="size-1.5 rounded-full bg-blue" />
        {scenario?.label ?? "Mock"}
      </button>
    </div>
  );
}
