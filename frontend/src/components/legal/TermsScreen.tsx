"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { dataModeLabel, env, isMockMode } from "@/config/env";
import { FWA_PARAMS } from "@/protocol/params";

/**
 * Plain-language terms. Nothing here is invented: no operating entity,
 * jurisdiction, address or contact is claimed, because none is published for
 * this build. Sections describe only what the software actually does.
 */
export function TermsScreen() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-3 py-5 sm:px-6">
      <article className="mx-auto w-full max-w-[68ch]">
        <header className="border-b border-line pb-4">
          <p className="mlabel text-secondary-readable">Legal</p>
          <h1 className="mt-2 text-lg font-semibold">Terms of Service</h1>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            These terms govern your use of the Hyper World Assets interface — the website you are reading right now.
            They are written to be read, not to be skipped. If something below is unacceptable to you, do not use the
            interface.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-mute">
            <span>
              Build data source <span className="text-dim">{dataModeLabel}</span>
            </span>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <span>
              Chain ID <span className="num font-mono text-dim">{env.chainId}</span>
            </span>
          </div>
        </header>

        <div className="mt-6 space-y-7">
          <Section id="what-this-is" title="1. What this interface is">
            <P>
              Hyper World Assets is a front end: open-source software that runs in your browser, reads public state from
              the HyperEVM network, and helps you format transactions that your own wallet may then sign and broadcast.
              It is a convenience layer over public smart contracts. Anyone can interact with those contracts without
              this interface, and anyone can run their own copy of this interface.
            </P>
            <P>
              Because the interface is only software, it makes no promises on behalf of the contracts and cannot alter
              how they behave. Where this document and the deployed contract code disagree, the contract code is what
              actually happens.
            </P>
          </Section>

          <Section id="what-the-protocol-does" title="2. What the protocol does">
            <P>
              Depositors escrow an NFT together with HYPE backing, which creates a listing. Purchasers pay HYPE for an
              acquisition attempt against the pool; a randomness draw selects one active listing and allocates it to the
              purchaser. The purchaser then settles: keep the NFT, keep and relist it, or accept the depositor&apos;s
              standing bid and receive part of the backing instead. If the purchaser does not settle within{" "}
              {Math.round(FWA_PARAMS.settlementWindowSec / 3600)} hours, the depositor may resolve the position; after{" "}
              {Math.round(FWA_PARAMS.finalizeWindowSec / 86_400)} days anyone may finalize the default outcome.
            </P>
            <P>
              Fees accrue to depositors and to the protocol as described in the interface at the moment you act. The
              parameters shown on screen are read from the deployment; they can change if the contracts are upgraded or
              redeployed.
            </P>
          </Section>

          <Section id="custody" title="3. The interface never holds your funds">
            <P>
              This interface has no wallet, no account and no server-side balance. It never takes custody of your HYPE,
              your NFTs, your private keys or your seed phrase, and it will never ask you for them. Every movement of
              value happens in a transaction that you approve in your own wallet, executed by smart contracts.
            </P>
            <P>
              While a position is escrowed, the relevant assets are held by those contracts under their published rules
              — not by anyone operating this website. Nobody here can reverse, refund, freeze or expedite a transaction
              on your behalf.
            </P>
          </Section>

          <Section id="randomness" title="4. Randomness and the risk of loss">
            <P>
              Acquisitions are decided by a randomness draw. Which listing you receive is not chosen by you and is not
              chosen by the interface. You may pay for an attempt and receive a listing you consider worth far less than
              you paid. That is an expected outcome of the mechanism, not a malfunction.
            </P>
            <P>
              Digital assets are volatile and can become illiquid or worthless. Smart contracts can contain bugs.
              Randomness sources, relayers, indexers and RPC providers can fail, stall or return wrong data. Network
              congestion can delay settlement past the point where an outcome still suits you. You can lose some or all
              of what you commit. Only commit funds you are prepared to lose entirely.
            </P>
          </Section>

          <Section id="no-advice" title="5. No investment advice">
            <P>
              Nothing in this interface — prices, odds, pool statistics, activity feeds, rewards figures or explanatory
              text — is financial, investment, legal or tax advice, a recommendation, or a solicitation. No one here is
              your broker, adviser or fiduciary. Numbers are shown to describe the current state of public contracts,
              not to predict returns. Do your own research, and take professional advice where you need it.
            </P>
          </Section>

          <Section id="build-status" title="6. Build status and displayed data">
            <P>
              {isMockMode ? (
                <>
                  This build is running on <strong className="font-semibold text-amber">simulated data</strong>. Pools,
                  listings, balances, prices and activity are generated locally for demonstration and testing. They
                  correspond to no real assets, and no transaction you submit here has any real effect.
                </>
              ) : env.dataMode === "testnet" ? (
                <>
                  This build is pointed at <strong className="font-semibold text-amber">HyperEVM testnet</strong>.
                  Testnet assets have no monetary value, and testnet state may be reset or discarded at any time without
                  notice.
                </>
              ) : (
                <>
                  This build is pointed at HyperEVM mainnet. Transactions you approve are real, irreversible, and move
                  real assets.
                </>
              )}
            </P>
            <P>
              Where a module is not deployed, the interface says so rather than inventing a value. Data reaches you
              through third-party infrastructure — RPC endpoints, indexers, block explorers, image hosts — that is
              outside anyone&apos;s control here and may be delayed, incomplete or simply wrong. Treat on-screen numbers
              as a best-effort view of chain state, and verify anything that matters against the chain itself before you
              act on it.
            </P>
          </Section>

          <Section id="your-responsibilities" title="7. Your responsibilities">
            <P>
              You are responsible for the security of your wallet and device, for reviewing every transaction before you
              approve it, and for confirming you are on the address you intend to use. You are responsible for
              determining whether using this software is lawful where you are, and for any tax that arises from what you
              do with it. Do not use the interface to launder funds, to evade sanctions, or to interact with assets you
              have no right to.
            </P>
            <P>
              NFT names, images and collection labels are supplied by third parties and are displayed as-is. They may be
              misleading, may impersonate other collections, or may link to content that has since changed. Verify the
              contract address of anything you care about.
            </P>
          </Section>

          <Section id="no-warranty" title="8. No warranty, and limits on liability">
            <P>
              The interface is provided &quot;as is&quot; and &quot;as available&quot;, without warranty of any kind,
              express or implied — including any implied warranty of merchantability, fitness for a particular purpose,
              title, or non-infringement. There is no guarantee that the interface will be available, accurate,
              uninterrupted, or free of defects, and no guarantee that the underlying contracts are free of bugs or
              economic flaws.
            </P>
            <P>
              To the maximum extent permitted by applicable law, the authors and contributors of this software are not
              liable for any loss of funds, loss of assets, loss of profits or loss of data arising from your use of the
              interface or of the contracts it talks to, whether the loss follows from a defect, a randomness outcome, a
              third-party failure, or your own transaction.
            </P>
          </Section>

          <Section id="open-source" title="9. Open source, and changes">
            <P>
              This interface is open-source software talking to public contracts. You may read it, fork it, host it
              yourself, and verify that it does what this page claims. Its licence ships with the source. Access to any
              particular hosted copy — including this one — may change or end at any time; the contracts remain
              reachable independently of it.
            </P>
            <P>
              These terms may change as the protocol changes. The version that applies is the one shipped with the build
              you are using; continuing to use the interface after a change means you accept the updated version.
            </P>
          </Section>

          <Section id="acceptance" title="10. Acceptance">
            <P>
              When you connect a wallet, the interface asks you to confirm that you have read and agree to these terms.
              That confirmation is stored locally in your browser, for the connected address only. It is not a wallet
              signature in this build, it is not sent anywhere, and it authorizes no transaction and moves no funds.
              Connecting a different address asks again; clearing your browser data clears the record.
            </P>
            <P className="text-mute">
              This document deliberately does not name an operating company, jurisdiction, postal address or contact
              email, because none is published for this build. If that changes, it will be stated here rather than
              implied.
            </P>
          </Section>
        </div>

        <footer className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Link href="/" className="text-xs text-accent hover:underline">
            ← Back to the pool
          </Link>
        </footer>
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2.5">{children}</div>
    </section>
  );
}

function P({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs leading-relaxed text-dim ${className}`}>{children}</p>;
}
