// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Solady
import {ERC721} from "solady/src/tokens/ERC721.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

// Chainlink VRF v2.5 — SUBSCRIPTION model. We do NOT inherit `VRFConsumerBaseV2Plus`: it declares a
// non-virtual `rawFulfillRandomWords` (so its callback can't be re-authorized) and pulls in Chainlink's
// `ConfirmedOwner`, which would clash with Solady's `Ownable`. Instead FWA hand-rolls the minimal consumer
// glue below (coordinator storage + a coordinator-only `rawFulfillRandomWords`), keeping Solady ownership
// and a single VRF path. Subscription is used over direct funding because its observed fulfillment
// latency is materially shorter and more predictable, reducing expirations at the fixed word deadline.
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

import {FWAConfigKeys} from "./FWAConfigKeys.sol";

interface IFWARewards {
    function token() external view returns (address);
    function fwa() external view returns (address);
    function onListingActivated(uint256 listingId, address depositor, uint256 backing) external;
    function onListingRepriced(uint256 listingId, uint256 newBacking) external;
    function onListingRemoved(uint256 listingId) external;
    function registerAcquisition(uint256 requestId, address purchaser, uint256 fee, uint256 surchargeBps)
        external
        returns (uint256 tokenSlice, uint64 rewardEpoch);
    function settleAcquisition(uint256 requestId) external payable;
    function refundAcquisition(uint256 requestId) external;
    function startEmission() external;
    function buyFor(address recipient, uint256 minOut) external payable returns (uint256 tokenOut);
}

interface IFWAVRFService {
    function requestFee() external view returns (uint256);
    function prepareRequests(uint256 requestCount) external payable;
}

/// @title FWA
/// @notice A randomized NFT acquisition pool with depositor-funded standing bids. A depositor lists
///         an ERC721 together with a chosen amount of ETH backing. That backing does two things: it
///         sets the listing's selection weight INVERSELY (weight is `NUM / backing`, so a
///         lightly-backed listing is selected more often and a richly-backed one less often), and it
///         funds an irrevocable standing bid from the depositor to reacquire the NFT. A purchaser
///         pays an expected-value-priced acquisition fee for a Chainlink VRF draw that allocates one
///         randomly selected listing in proportion to its weight. The purchaser then either keeps
///         the NFT or accepts the depositor's standing bid — selling the NFT back to its depositor
///         for the escrowed ETH. The two outcomes are mutually exclusive: a purchaser can never
///         retain both the NFT and the ETH.
/// @dev Economic design:
///      - Each listing's backing ETH is escrowed per listing and only ever settles that listing's
///        standing bid, so the contract is always solvent and any un-allocated listing is fully
///        withdrawable by its depositor.
///      - Acquisitions are priced at the pool's expected value times a protocol surcharge:
///        `EV = Σ(weightᵢ·backingᵢ) / Σweightᵢ`. With inverse weights (`weightᵢ·backingᵢ ≈ NUM`)
///        this reduces to the harmonic mean of the backings — so a pool of richer listings prices
///        *cheaper*, reflecting that an acquisition is far more likely to land a lightly-backed one.
///      - Acquisition fees are shared among depositors EQUALLY per active listing via a dividend
///        accumulator (each listing's fee share is a flat 1), so a lightly-backed listing earns the
///        same per-acquisition fee as a richly-backed one. This keeps acquisitions cheap and small
///        deposits attractive. Fees accrue as a withdrawable credit.
///      - The size incentive lives in a separate, marketable TOP-BACKED LISTING: a single tracked
///        top listing earns a `topListingShareBps` share off every acquisition into a visible,
///        growing pot that settles to the top holder's credit when their listing is allocated,
///        withdrawn, or taken over. The top slot tracks committed backing — a deposit (or a raise)
///        that clears the current top by `topThresholdBps` auto-seizes it, a vacant top is taken by
///        the next deposit, and an already-active listing seizes it via `claimTopSpot` once it
///        clears the bar. Reducing your own backing — a withdraw or a lower re-price — forfeits it.
///        Richly-backed listings also have low (inverse) weight, so they are allocated rarely and
///        hold the top slot longer, compounding the incentive for the highest-committed backers.
///      Selection runs in O(TREE_DEPTH) via a sparse segment tree over active listing slots.
///      Uses Chainlink VRF v2.5 SUBSCRIPTION (native payment): an external `FWAVRFService` receives each
///      purchaser's service fee, pre-funds callback coverage, and may use only proven surplus to sponsor
///      canonical processing — so an acquisition never draws down escrowed backing or depositor fees.
contract FWA is Ownable, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/

    enum ListingStatus {
        None,
        Active,
        Allocated,
        Withdrawn,
        Settled,
        // A deposit made while an acquisition is unresolved: escrowed but NOT yet in the selection
        // pool. A later request may reserve it before asking VRF; otherwise it activates once the
        // sequencer is idle. Appended last so pre-existing numeric listing states remain stable.
        Staged
    }

    enum AcquisitionStatus {
        None,
        Pending, // waiting for an on-time VRF word
        Fulfilled,
        Expired, // skipped in sequence after its word deadline; escrowed fee credited for withdrawal
        Refunded, // no listing / slippage refund; escrowed fee credited for withdrawal
        Ready, // an on-time word is cached and must be settled in request order
        TimedOut // a callback arrived after its deadline; the request is skipped when it reaches the head

    }

    struct Listing {
        address collection;
        address depositor;
        address purchaser;
        uint256 tokenId;
        uint256 weight; // selection weight; derived as NUM / backing (weight ∝ 1 / backing)
        uint256 value; // backing ETH escrowed for this listing (funds the depositor's standing bid)
        uint256 feeShare; // fee-distribution share key, √backing, fixed at deposit
        uint256 feeDebt; // dividend-accumulator checkpoint (scaled by SCALE)
        uint256 slot;
        uint64 allocatedAt; // timestamp the listing was allocated; gates the purchaser settlement window
        ListingStatus status;
    }

    struct Acquisition {
        address purchaser;
        uint256 requestBlock;
        uint256 priceEscrowed; // acquisition fee held until the acquisition settles (distributed) or is refunded
        uint256 listingId;
        AcquisitionStatus status;
    }

    /// @dev Sequencing fields are separate so the existing public `acquisitions(requestId)` getter ABI
    ///      remains stable for indexers. Every value is fixed at request time except `randomWord`, which
    ///      the authenticated VRF callback writes exactly once.
    struct AcquisitionMeta {
        uint64 sequence;
        uint64 wordDeadlineBlock;
        uint64 rewardEpoch;
        uint16 maxPositiveSlippageBps;
        uint16 maxNegativeSlippageBps;
        uint256 randomWord;
    }

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /*
        Supports 2^32 simultaneously active listings.

        This does NOT allocate 2^32 storage slots. The tree is a mapping,
        so only nodes that are actually touched consume storage.

        Each insertion/removal/selection takes roughly TREE_DEPTH steps.
    */
    uint256 internal constant TREE_DEPTH = 32;
    uint256 internal constant CAPACITY = 1 << TREE_DEPTH;

    /*
        Segment tree layout:

                           node 1
                         /        \
                    node 2         node 3
                    / ...           ... \

        Leaves begin at index CAPACITY.

        Listing slot 1           => tree node CAPACITY
        Listing slot 2           => tree node CAPACITY + 1
        Listing slot CAPACITY    => tree node (2 * CAPACITY) - 1
    */
    uint256 internal constant LEAF_BASE = CAPACITY;

    /// @notice Denominator for basis-point math.
    uint256 public constant BPS = 10_000;

    /// @notice Fixed-point numerator for the inverse selection weight. A listing's acquisition weight is
    ///         `INVERSE_WEIGHT_NUMERATOR / value`, so selection weight are INVERSELY proportional to backing.
    ///         As a shared constant it cancels in the relative selection weight between any two listings and
    ///         only sets the absolute precision of the weights; sized far above any realistic
    ///         backing so `NUM / value` never rounds to zero for a sane listing.
    uint256 internal constant INVERSE_WEIGHT_NUMERATOR = 1e36;

    /// @notice Fixed-point scale for the fee dividend accumulator. Fees are shared by the
    ///         per-listing key `√value` (summed into `feeShareTotal`); SCALE keeps
    ///         `fee·SCALE / feeShareTotal` from rounding to zero and silently dropping fees.
    ///         The product `feeShare·accFeePerEV` is bounded by `Σfees·SCALE` (≈1e60 for any
    ///         realistic fee history), comfortably within uint256.
    uint256 internal constant SCALE = 1e36;

    /*//////////////////////////////////////////////////////////////
                              VRF CONFIG
    //////////////////////////////////////////////////////////////*/

    /// @notice Chainlink VRF v2.5 coordinator. FWA requests randomness against `vrfSubId` and the
    ///         coordinator calls `rawFulfillRandomWords` back (the only authorized caller). Owner-settable
    ///         (`setAddr(VRF_COORDINATOR)`) so a Chainlink coordinator migration can be followed without redeploy.
    IVRFCoordinatorV2Plus internal s_vrfCoordinator;

    /// @notice The VRF subscription that pays fulfillment gas. Owned by an EOA/multisig (which runs
    ///         `createSubscription`/`addConsumer` and can cancel/recover); the immutable service reads
    ///         this id and funds it permissionlessly from purchaser fees before FWA issues requests.
    uint256 internal vrfSubId;

    /// @notice External fee, subscription-funding, and optional processor-sponsorship module.
    ///         Immutable so purchaser fees cannot be redirected after deployment.
    IFWAVRFService public immutable vrfService;

    /// @notice VRF gas lane (key hash) selecting the price ceiling for requests. It can be changed only
    ///         through the immutable service together with the callback coverage underwriting it.
    bytes32 internal vrfKeyHash;

    /// @notice Number of random words requested per acquisition.
    uint32 internal constant NUM_WORDS = 1;

    /// @notice Gas limit for the cache-first VRF callback. With at least
    ///         `MIN_FAST_PATH_CALLBACK_GAS_LIMIT`, an in-order word whose request owns no reserved
    ///         listings gets one failure-isolated settlement attempt; every other word remains cached
    ///         for the public processor. Adjustable only through the immutable service while paused.
    uint32 public callbackGasLimit;
    uint32 public constant MIN_CALLBACK_GAS_LIMIT = 150_000;
    uint32 public constant MAX_CALLBACK_GAS_LIMIT = 2_500_000;

    /// @dev The fast path forwards a fixed stipend into the existing guarded one-item processor and
    ///      retains enough parent gas to return successfully even if the subcall consumes its stipend.
    uint32 internal constant MIN_FAST_PATH_CALLBACK_GAS_LIMIT = 900_000;
    uint256 internal constant CALLBACK_FAST_PATH_GAS = 700_000;
    uint256 internal constant CALLBACK_RETURN_GAS_RESERVE = 50_000;

    /// @notice Block confirmations the coordinator waits before responding. Constrained to Chainlink's
    ///         supported 3..200 range, with at least `MIN_CALLBACK_SLACK_BLOCKS` before the word deadline.
    uint16 internal requestConfirmations = 3;

    /// @notice Floor on `requestConfirmations`. It is the security axiom — no VRF word can exist before
    ///         this many blocks — so the setters never let it drop below the Chainlink minimum of 3.
    uint256 internal constant MIN_REQUEST_CONFIRMATIONS = 3;
    uint256 internal constant MAX_REQUEST_CONFIRMATIONS = 200;
    uint256 internal constant MIN_CALLBACK_SLACK_BLOCKS = 2;

    /*//////////////////////////////////////////////////////////////
                         ACQUISITION SEQUENCER
    //////////////////////////////////////////////////////////////*/

    /// @notice Maximum FIFO staged listings committed to each acquisition before its VRF request.
    ///         The callback never activates them; the canonical processor activates exactly this
    ///         request-time batch immediately before settling that sequence.
    uint256 public maxActivationsPerAcquisition = 6;
    uint256 internal constant MAX_ACTIVATIONS_PER_ACQUISITION = 16;

    /// @notice Number of requests still waiting for a callback. A cached word reduces this counter but
    ///         remains unresolved until canonical processing advances its sequence.
    uint256 public pendingAcquisitionCount;

    /// @notice Number of issued VRF requests for which the authenticated coordinator callback has not
    ///         yet been observed. Unlike `pendingAcquisitionCount`, local expiry does not reduce this:
    ///         Chainlink may still fulfill and bill the subscription later.
    uint256 public unfulfilledVrfCount;

    /// @dev First-callback marker keeps `unfulfilledVrfCount` duplicate-safe, including after local expiry.
    mapping(uint256 requestId => bool observed) internal callbackObserved;

    /// @notice Number of issued acquisitions not yet terminally processed. This is the pool-mutation
    ///         lock: it remains non-zero after words are cached and only falls as the sequence advances.
    uint256 public unsettledAcquisitionCount;

    /// @notice Absolute per-request word deadline offset. A callback at `requestBlock + timeout` is
    ///         accepted; a callback after it is permanently late. Snapshotted into each acquisition.
    uint256 public selectionTimeoutBlocks = 30;

    /// @notice Upper bound on the configurable word deadline.
    uint256 internal constant MAX_WINDOW_BLOCKS = 7_200;

    /// @notice Max acquisitions a single `acquireBatch` batch may fire, bounding the request-tx loop.
    ///         Owner-adjustable.
    uint256 public maxAcquisitionsPerTx = 5;

    /// @notice Monotonic request sequence. VRF callbacks may arrive in any order, but only
    ///         `nextSequenceToProcess` may mutate the pool.
    uint64 public lastIssuedSequence;
    uint64 public nextSequenceToProcess = 1;

    /// @notice Gates acquisitions. Starts `false` so the pool deploys in a "loading" phase: deposits
    ///         and withdrawals work, but no one can acquisition until the owner opens the game. Owner
    ///         flips it on with `setBool(ACQUISITIONS_ENABLED, true)`.
    bool public acquisitionsEnabled;

    /// @notice Emergency switch. When on, new acquisitions and deposits are halted. Already-issued
    ///         sequences remain cacheable and processable; once the ordered prefix is terminal,
    ///         active-listing exits unlock normally. Owner-toggled, independent of `acquisitionsEnabled`.
    bool public withdrawOnly;

    /// @notice When true, only collections in `collectionWhitelisted` may be deposited as NEW
    ///         listings; flip it off to allow any ERC721. Affects deposits only — listings already in
    ///         the pool, plus acquisitions and claims, are never gated by the whitelist. Owner-toggled.
    bool public whitelistEnabled = true;

    /// @notice One-way launch latch. HyperEVM mainnet enables it at deployment so gameplay cannot
    ///         start before the fixed rewards module is bound and funded.
    bool public rewardsRequiredForActivation;

    /// @notice Collections allowed for NEW listing deposits while `whitelistEnabled` is true.
    mapping(address => bool) public collectionWhitelisted;

    /// @dev Owner-appointed address (typically a curation contract) also allowed to update the
    ///      collection whitelist. Zero (the default) means owner-only. Set via
    ///      `setAddr(WHITELIST_MANAGER, ...)`; indexers track it through `ConfigSet`.
    address internal whitelistManager;

    /*//////////////////////////////////////////////////////////////
                            ECONOMIC CONFIG
    //////////////////////////////////////////////////////////////*/

    /// @notice Protocol surcharge added on top of expected value when pricing an acquisition, in bps.
    uint256 public surchargeBps = 1_000; // 10%

    /// @notice Protocol maximum positive price drift accepted at ordered settlement. Snapshotted per
    ///         request. Purchasers may separately choose their maximum negative drift, up to 100%.
    uint256 public selectionSlippageBps = 1_000; // 10%

    /// @notice Fraction of a listing's backing a purchaser receives if they take ETH, in bps.
    ///         The retained remainder is the settlement penalty, routed per `retainedToProtocol`.
    uint256 public settlementDiscountBps = 8_500; // purchaser gets 85% on an ETH settlement

    /// @notice How long the purchaser has the exclusive right to choose NFT-or-ETH. After it lapses
    ///         the depositor may resolve the listing themselves (`depositorReclaimBacking` /
    ///         `depositorReclaimNFT`); the purchaser can still claim too. Must be <= `finalizeWindow`.
    uint256 public settlementWindow = 24 hours;

    /// @notice After this elapses from the acquisition with no resolution, `finalizeUnsettled` becomes
    ///         permissionless (default: NFT to purchaser, backing to depositor), so assets never
    ///         lock even if both parties walk away. Must be >= `settlementWindow`.
    uint256 public finalizeWindow = 7 days;

    /// @dev Administrative bounds keep future listings usable while preserving the reviewed
    ///      24-hour / 7-day defaults. Each allocated listing snapshots both values below.
    uint256 public constant MIN_SETTLEMENT_WINDOW = 1 hours;
    uint256 public constant MAX_SETTLEMENT_WINDOW = 7 days;
    uint256 public constant MIN_FINALIZE_WINDOW = 1 days;
    uint256 public constant MAX_FINALIZE_WINDOW = 30 days;

    /// @notice Minimum backing ETH a deposit must escrow. `0` disables the floor. Guards against dust
    ///         listings that would distort the pool's pricing and selection weight, and — because the
    ///         acquisition-fee split is a flat share per active listing — raises the capital cost of
    ///         sybil fee-farming with many tiny listings. Defaults to a non-zero floor for that reason;
    ///         owner-adjustable (including back to `0`).
    uint256 public minBacking = 0.01 ether;

    /// @notice Immutable bounds on the purchaser's ETH settlement payout. These keep the configurable
    ///         payout near its intended 85% while limiting the retained protocol share to at most 20%.
    uint256 internal constant MIN_SETTLEMENT_DISCOUNT_BPS = 8_000;
    uint256 internal constant MAX_SETTLEMENT_DISCOUNT_BPS = 9_500;

    /// @notice Protocol fee on each acquisition, in bps of the pool acquisition fee, routed to the owner.
    ///         Carved out of the depositor surcharge — the purchaser pays the same total. `0` disables.
    uint256 public ownerAcquisitionFeeBps = 100; // 1%

    /// @notice Protocol fee on an NFT-outcome resolution (`keepNFT` / `depositorReclaimBacking` /
    ///         `finalizeUnsettled`), in bps of the listing value, taken from the depositor's backing
    ///         return. ETH settlements are NOT charged this — there the retained settlementDiscount is the
    ///         protocol's whole take (see `retainedToProtocol`), so the purchaser keeps the full
    ///         `settlementDiscountBps`. Hard-capped at 5% of backing. `0` disables.
    uint256 public ownerSettlementFeeBps = 100; // 1% of listing value

    /// @notice Immutable maximum protocol cut from backing on an NFT-outcome resolution.
    uint256 internal constant MAX_OWNER_SETTLEMENT_FEE_BPS = 500;

    /// @notice Destination of the retained settlementDiscount on an ETH claim — the `1 - settlementDiscountBps` slice of
    ///         backing a purchaser forgoes by accepting the bid instead of taking the NFT. When true (the
    ///         default), that settlement penalty accrues to the protocol; when false it is shared among
    ///         active depositors (the original behaviour). Owner-toggled; does not change what the
    ///         purchaser receives, only who keeps the forgone remainder.
    bool public retainedToProtocol = true;

    /// @notice Slice of each acquisition's distributable fee routed to the top-listing pot, in bps.
    ///         Carved before the equal per-listing distribution and credited to the top holder; the
    ///         purchaser pays the same total. `0` disables (topListingShare folds back into the equal split).
    uint256 public topListingShareBps = 500; // 5% of the distributable acquisition fee

    /// @notice Hysteresis for seizing the top: a challenger's backing must be at least the current
    ///         top's value × (1 + `topThresholdBps`/BPS) to take it via `claimTopSpot`.
    ///         `0` means ties (>=) acquire. Stops the top from flipping on a dust-sized overtake.
    uint256 public topThresholdBps = 1_000; // must exceed the top by 10%

    /*//////////////////////////////////////////////////////////////
                            LISTING STORAGE
    //////////////////////////////////////////////////////////////*/

    uint256 public nextListingId = 1;

    mapping(uint256 listingId => Listing) public listings;
    /// @notice Immutable-per-allocation settlement windows. Admin changes only affect listings
    ///         allocated after the change and can never retroactively accelerate an existing one.
    mapping(uint256 listingId => uint64 window) public settlementWindowAtAllocation;
    mapping(uint256 listingId => uint64 window) public finalizeWindowAtAllocation;

    /// @notice Recipient entitled to pull a resolved listing's NFT whose delivery reverted at
    ///         resolution (a pausable/non-standard/misbehaving collection). `0` if none pending.
    ///         The ETH side of that resolution already settled; only the NFT is outstanding.
    mapping(uint256 listingId => address recipient) public stuckNFTRecipient;

    /*//////////////////////////////////////////////////////////////
                          STAGING QUEUE (FIFO)
    //////////////////////////////////////////////////////////////*/

    /*
        Deposits made while an acquisition is unresolved are parked here — escrowed but excluded from
        every pool total and from the selection tree. Each later acquisition detaches up to
        `maxActivationsPerAcquisition` entries from the FIFO into its immutable reserved batch before
        requesting VRF. The canonical processor activates exactly that batch at the acquisition's turn.
    */
    uint256 internal stagingHead; // first (oldest) staged listing; 0 when empty
    uint256 internal stagingTail; // last (newest) staged listing; 0 when empty
    mapping(uint256 listingId => uint256) internal stagingNext; // toward the tail; 0 = none
    mapping(uint256 listingId => uint256) internal stagingPrev; // toward the head; 0 = none

    /// @notice Unreserved staging-queue length, kept in lockstep with the FIFO.
    uint256 public stagedCount;

    /// @notice Optional cap on the unreserved staging FIFO (`0` = unlimited, the default). This is
    ///         an operational throttle only; request-time reservation, not queue length, provides the
    ///         anti-steering boundary. Owner-set via `setUint(MAX_STAGED_LISTINGS, ...)`.
    uint256 internal maxStagedListings;

    /// @notice Sequence that owns a detached staged listing; zero means it remains unreserved.
    mapping(uint256 listingId => uint64 sequence) public reservedForSequence;
    uint256 public reservedStagedCount;

    /// @dev Exact request-time activation batch. Its length is bounded by
    ///      `maxActivationsPerAcquisition`, and its entries are removed from the public staging FIFO.
    mapping(uint64 sequence => uint256[]) internal reservedListingsBySequence;

    /*
        Active slot => permanent listing ID.

        A listing ID is never reused.
        A tree slot can be reused after its listing leaves the active pool.
    */
    mapping(uint256 slot => uint256 listingId) public slotToListing;

    uint256 public activeListingCount;
    uint256 public totalWeight;

    /// @notice Σ(weightᵢ · valueᵢ) over active listings. Drives the expected-value acquisition price:
    ///         with inverse weights each term `weightᵢ·valueᵢ ≈ NUM`, so this tracks
    ///         ≈ `activeListingCount · NUM` and `weightedBackingTotal / totalWeight` works out to
    ///         the harmonic mean of the values. (Fee distribution uses `feeShareTotal`, not this.)
    uint256 public weightedBackingTotal;
    /// @notice Exact active-listing backing sum for indexer-independent telemetry.
    uint256 public activeBackingTotal;

    /// @notice Σ feeShareᵢ over active listings — the denominator for the fee dividend accumulator.
    ///         Each listing's share is a flat 1 (equal-per-listing distribution), so this tracks
    ///         `activeListingCount`. Kept as its own running sum so the fee basis stays independent of
    ///         the EV-based acquisition-price basis (`weightedBackingTotal`). The size incentive that the old
    ///         √value weighting provided now lives in the separate top-listing topListingShare.
    uint256 public feeShareTotal;

    /*//////////////////////////////////////////////////////////////
                          FEE DISTRIBUTION
    //////////////////////////////////////////////////////////////*/

    /// @dev Accumulated fee per unit of fee share (a flat 1 per listing), scaled by SCALE.
    ///      A listing's pending fees are `feeShare * accFeePerEV / SCALE - feeDebt`.
    uint256 internal accFeePerEV;

    /// @notice Withdrawable earnings (settled acquisition-fee share) per depositor.
    mapping(address depositor => uint256 amount) public feeCredit;

    /// @notice Protocol fees accrued — the acquisition-fee cut, the settlementDiscount cut, and any distribution
    ///         that had no active pool to receive it — held in-contract until paid out via the
    ///         permissionless `payoutFees`.
    uint256 public accruedOwnerFees;

    /// @notice Destination for protocol fees. Owner-configurable; defaults to the deployer.
    ///         Anyone may call `payoutFees` to push the accrued balance here.
    address public payoutAddress;

    /*//////////////////////////////////////////////////////////////
                              TOP LISTING
    //////////////////////////////////////////////////////////////*/

    /// @notice The active listing currently holding the top; `0` when vacant. The top earns a
    ///         topListingShare off every acquisition (`topListingShareBps`). A deposit or claim that clears the bar
    ///         auto-seizes it, but we store only this id: on vacate we never scan for or backfill to
    ///         the next-largest listing — the top simply opens until the next deposit or claim takes it.
    uint256 public topListingId;

    /// @notice TopListingShare accrued for the CURRENT top holder but not yet settled — a visible, growing
    ///         pot. It is credited to the holder's `feeCredit` the moment the top is vacated (its
    ///         listing is allocated, withdrawn, or taken over) and then resets to 0 for the next holder, so
    ///         each holder banks exactly what accrued during their tenure.
    uint256 public topListingPot;

    /*//////////////////////////////////////////////////////////////
                         FWAToken REWARDS MODULE
    //////////////////////////////////////////////////////////////*/

    /// @notice FWAToken receives the protocol-fee buyback portion. Participant rewards and all swaps
    ///         live in the separately deployed `FWARewards` module.
    address public token;
    IFWARewards public rewards;

    /// @notice Whether a purchaser may accept the bid as FWAToken via `acceptBidAsTokens`. Owner-toggled; `acceptDepositorBid` (the
    ///         plain ETH settlement) is always available regardless.
    bool internal acceptBidAsTokensEnabled = true;

    /// @notice ETH slice of an acquisition's surcharge earmarked to buy FWAToken for the purchaser on success.
    mapping(uint256 requestId => uint256) public acquisitionTokenSlice;

    // --- Protocol-fee -> FWAToken buy pressure (Phase-2 sink) ---

    /// @notice Fraction of accrued protocol fees (the in-game cuts: acquisition cut + NFT-settlementDiscount + retained
    ///         settlementDiscount) routed into FWAToken buy pressure on `payoutFees`; the rest still pays out to the
    ///         owner. `0` = off (default) — flip on for Phase 2. The LP 1% fee is never included.
    ///         The buy/burn/redistribute then happens in the FWAToken token's TWAP `buyback`; the sink mode
    ///         (burn vs redistribute) lives there.
    uint256 public protocolFeeToTokenBps;

    /*//////////////////////////////////////////////////////////////
                          SPARSE SEGMENT TREE
    //////////////////////////////////////////////////////////////*/

    /*
        tree[node] contains the total weight beneath that node.

        This replaces a giant array. Unused nodes simply return zero.
    */
    mapping(uint256 node => uint256 weight) internal tree;

    /*//////////////////////////////////////////////////////////////
                            SLOT FREE LIST
    //////////////////////////////////////////////////////////////*/

    /*
        Slots are initially allocated sequentially.

        When a listing is allocated or withdrawn, its slot is placed into
        a linked-list free pool and can be assigned to another listing.
    */
    uint256 internal nextUnusedSlot = 1;
    uint256 internal freeSlotHead;

    mapping(uint256 slot => uint256 nextFreeSlot) internal nextFreeSlot;

    /*//////////////////////////////////////////////////////////////
                              ACQUISITION STORAGE
    //////////////////////////////////////////////////////////////*/

    mapping(uint256 requestId => Acquisition) public acquisitions;
    mapping(uint256 requestId => AcquisitionMeta) public acquisitionMeta;
    mapping(uint64 sequence => uint256 requestId) public requestIdAtSequence;

    /// @notice Pull-based acquisition refunds. Ordered processing never calls an untrusted purchaser.
    mapping(address purchaser => uint256 amount) public acquisitionRefundCredit;
    uint256 public acquisitionRefundCreditTotal;
    uint256 public acquisitionEscrowTotal;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event NFTListed(
        uint256 indexed listingId,
        uint256 indexed slot,
        address indexed depositor,
        address collection,
        uint256 tokenId,
        uint256 weight,
        uint256 value
    );

    /// @param value The listing's backing/weight, so an indexer can debit the pool's active value
    ///        from this event alone (no join back to `NFTListed`).
    event ListingWithdrawn(uint256 indexed listingId, address indexed depositor, uint256 value);

    /// @dev A deposit landed while an acquisition was unresolved (or behind an older FIFO entry), so
    ///      it was parked outside the selection tree. `stagedAtBlock` is informational; a later request
    ///      may reserve the listing before VRF, otherwise it activates after the sequencer becomes idle.
    event ListingStaged(
        uint256 indexed listingId,
        address indexed depositor,
        address collection,
        uint256 tokenId,
        uint256 value,
        uint256 stagedAtBlock
    );

    /// @dev A depositor re-priced an active listing's backing. `newWeight` lets an indexer update
    ///      the active pool weight/value from this event alone.
    event BackingUpdated(
        uint256 indexed listingId, address indexed depositor, uint256 oldBacking, uint256 newBacking, uint256 newWeight
    );

    event AcquisitionRequested(
        uint256 indexed requestId, address indexed purchaser, uint256 acquisitionFee, uint256 totalWeight
    );

    /// @dev Local sequence and immutable timeout assigned to a VRF request. `reservedCount` is the
    ///      exact FIFO activation batch committed before randomness was requested.
    event AcquisitionSequenced(
        uint256 indexed requestId, uint64 indexed sequence, uint64 wordDeadlineBlock, uint256 reservedCount
    );

    event RandomnessCached(uint256 indexed requestId, uint64 indexed sequence, uint256 randomWord);
    event RandomnessTimedOut(
        uint256 indexed requestId, uint64 indexed sequence, uint64 wordDeadlineBlock, uint256 callbackBlock
    );
    event FulfillmentIgnored(uint256 indexed requestId, AcquisitionStatus status);
    event UnfulfilledVrfReconciled(uint256 count);
    /// @dev `processor` is `address(this)` when the failure-isolated callback self-call succeeds;
    ///      otherwise it is the address that called the public processor.
    event AcquisitionProcessed(
        uint256 indexed requestId, uint64 indexed sequence, AcquisitionStatus status, address indexed processor
    );
    event AcquisitionRefundWithdrawn(address indexed purchaser, uint256 amount);

    event AcquisitionExpired(
        uint256 indexed requestId, uint64 indexed sequence, address indexed purchaser, uint256 refund
    );

    /// @dev Ordered processing reached an empty pool, so no listing could be allocated and the
    ///      escrowed acquisition fee became a purchaser pull credit.
    event AcquisitionRefundedNoListing(uint256 indexed requestId, address indexed purchaser, uint256 refund);

    /// @dev Ordered processing found price drift beyond the request's positive / negative tolerances,
    ///      so the acquisition was refunded instead of paid out. Distinct from
    ///      `AcquisitionRefundedNoListing` so the two refund causes are distinguishable off-chain.
    event AcquisitionRefundedSlippage(
        uint256 indexed requestId, address indexed purchaser, uint256 refund, uint256 escrowedFee, uint256 liveFee
    );

    /// @param depositor The listing's depositor, and `value` its backing/weight, so an indexer can
    ///        debit the pool's active value and attribute the deposit duration from this event
    ///        alone (no join back to `NFTListed`).
    event NFTAllocated(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed purchaser,
        address depositor,
        uint256 value,
        uint256 randomWord
    );

    event NFTKept(uint256 indexed listingId, address indexed purchaser, address indexed depositor, uint256 backing);

    /// @dev Old listing settled keepNFT-style but the NFT stayed in custody, re-listed as
    ///      `newListingId` with the purchaser as depositor. Purchaser/depositor/new backing are
    ///      recoverable from `NFTAllocated` plus the new listing's `NFTListed`/`ListingStaged`,
    ///      which fire separately.
    event NFTRelisted(uint256 indexed listingId, uint256 indexed newListingId, uint256 toDepositor);

    event DepositorBidAccepted(
        uint256 indexed listingId,
        address indexed purchaser,
        address indexed depositor,
        uint256 payout,
        uint256 retained
    );

    /// @dev Purchaser cashed out via `acceptBidAsTokens`: `ethPayout` of backing bought `tokenOut` FWAToken for them.
    event DepositorBidAcceptedAsTokens(
        uint256 indexed listingId,
        address indexed purchaser,
        address indexed depositor,
        uint256 ethPayout,
        uint256 retained,
        uint256 tokenOut
    );

    event UnsettledFinalized(uint256 indexed listingId, address indexed purchaser, address indexed depositor);
    /// @dev Distinguishes the two depositor-initiated timeout paths from economically identical
    ///      purchaser settlements in indexers and user interfaces.
    event DepositorTimeoutResolved(uint256 indexed listingId, address indexed depositor, bool nftReclaimed);

    /// @dev A resolved listing's NFT could not be delivered (the collection reverted); `recipient`
    ///      may pull it later via `recoverStuckNFT`. The resolution's ETH legs still settled.
    event NFTDeliveryFailed(uint256 indexed listingId, address indexed recipient, address collection, uint256 tokenId);

    event StuckNFTRecovered(uint256 indexed listingId, address indexed recipient);

    /// @dev Acquisition-fee share settled into a depositor's withdrawable `feeCredit`, keyed by the
    ///      listing whose accrued fees were settled. (Distributions with no active pool to receive
    ///      them are routed to protocol fees and emit `OwnerFeesAccrued` instead.) An indexer can
    ///      track each address's claimable balance as `Σ EarningsAccrued − Σ EarningsWithdrawn`.
    event EarningsAccrued(address indexed depositor, uint256 indexed listingId, uint256 amount);

    event EarningsWithdrawn(address indexed depositor, uint256 amount);

    /// @dev A single-value owner-config change (`setUint`/`setBool`/`setAddr`). `key` is a
    ///      `FWAConfigKeys` constant (globally unique across the three dispatchers); bools encode
    ///      as 0/1, addresses as `uint256(uint160(a))`, the VRF key hash as `uint256(keyHash)`.
    event ConfigSet(uint256 indexed key, uint256 value);
    /// @dev A purchaser paid `amount` wei into the immutable external VRF service.
    event VrfServiceFeePaid(address indexed purchaser, uint256 amount);
    event CollectionWhitelistSet(address indexed collection, bool allowed);

    /// @dev Protocol fee accrued (from an acquisition, a claim, or an unallocated distribution).
    event OwnerFeesAccrued(uint256 amount);
    /// @dev Accrued protocol fees paid out to the payout address.
    event FeesPaidOut(address indexed to, uint256 amount);

    /// @dev The top moved to `listingId` (`0` = vacated); `depositor` is the new holder (or `0`).
    event TopListingSet(uint256 indexed listingId, address indexed depositor);
    /// @dev An acquisition's topListingShare was added to the live pot for the current top holder.
    event TopListingFunded(uint256 indexed listingId, uint256 amount, uint256 newPot);
    /// @dev The top was vacated; `amount` settled into `depositor`'s withdrawable `feeCredit`.
    event TopListingSettled(uint256 indexed listingId, address indexed depositor, uint256 amount);

    event RewardsConfigured(address indexed rewards, address indexed token);
    /// @dev `amount` ETH of protocol fees was routed to the FWAToken token's buyback reserve on payout.
    event ProtocolFeesToToken(uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroBacking();
    error BelowMinBacking();
    error BackingTooHigh();
    error InvalidCollection();
    error CollectionNotWhitelisted();
    error ListingNotActive();
    error ListingNotAllocated();
    error NotDepositor();
    error NotPurchaser();
    error NoActiveListings();
    error WithdrawLocked();
    error InvalidTreeResult();
    error ActiveListingCapacityReached();
    error StagingQueueFull();
    error NFTTransferFailed();
    error InsufficientPayment();
    error AcquisitionFeeTooHigh();
    error InvalidAcquisitionCount();
    error PoolValueTooLow();
    error SettlementWindowNotElapsed();
    error InvalidConfig();
    error NoEarnings();
    error NotStuckRecipient();
    error WithdrawOnlyActive();
    error AcquisitionsNotEnabled();
    error NoOwnerFees();
    error TopNotBeaten();
    error TokenNotConfigured();
    error OnlyCoordinator();
    error AcceptBidAsTokensDisabled();
    error SequenceInvariantBroken();
    error NoAcquisitionRefund();
    error AcquisitionStateLocked();
    error OnlyVrfService();
    error VrfRequestsPending();
    error DuplicateRequestId();
    // `Unauthorized()` is inherited from Solady's Ownable.

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @param coordinator Chainlink VRF v2.5 coordinator for the target chain.
    /// @param subId       The VRF subscription that pays fulfillment gas (owned by an EOA/multisig; the
    ///                    owner must `addConsumer(subId, address(this))` before acquisitions can settle).
    /// @param keyHash     The VRF gas lane (price ceiling) for requests.
    /// @param callbackGasLimit_ Gas made available to the VRF consumer callback.
    /// @param service     The separately deployed FWAVRFService that receives purchaser service fees.
    constructor(address coordinator, uint256 subId, bytes32 keyHash, uint32 callbackGasLimit_, address service) {
        if (
            coordinator == address(0) || subId == 0 || keyHash == bytes32(0)
                || callbackGasLimit_ < MIN_CALLBACK_GAS_LIMIT || callbackGasLimit_ > MAX_CALLBACK_GAS_LIMIT
                || service == address(0) || service.code.length == 0
        ) {
            revert InvalidConfig();
        }
        s_vrfCoordinator = IVRFCoordinatorV2Plus(coordinator);
        vrfSubId = subId;
        vrfKeyHash = keyHash;
        callbackGasLimit = callbackGasLimit_;
        vrfService = IFWAVRFService(service);

        _initializeOwner(msg.sender);
        payoutAddress = msg.sender; // default the fee destination to the deployer

        // Emit the initial config so an indexer can reconstruct full state from logs alone,
        // without a contract read at the deploy block. (Solady's _initializeOwner already
        // logged OwnershipTransferred for the owner.) Constructor code is initcode-only, so
        // these emits cost no runtime bytecode.
        emit ConfigSet(FWAConfigKeys.VRF_COORDINATOR, uint256(uint160(coordinator)));
        emit ConfigSet(FWAConfigKeys.VRF_SUB_ID, subId);
        emit ConfigSet(FWAConfigKeys.VRF_KEY_HASH, uint256(keyHash));
        emit ConfigSet(FWAConfigKeys.VRF_SERVICE, uint256(uint160(service)));
        emit ConfigSet(FWAConfigKeys.SURCHARGE_BPS, surchargeBps);
        emit ConfigSet(FWAConfigKeys.SETTLEMENT_DISCOUNT_BPS, settlementDiscountBps);
        emit ConfigSet(FWAConfigKeys.OWNER_ACQUISITION_FEE_BPS, ownerAcquisitionFeeBps);
        emit ConfigSet(FWAConfigKeys.OWNER_SETTLEMENT_FEE_BPS, ownerSettlementFeeBps);
        emit ConfigSet(FWAConfigKeys.SETTLEMENT_WINDOW, settlementWindow);
        emit ConfigSet(FWAConfigKeys.FINALIZE_WINDOW, finalizeWindow);
        emit ConfigSet(FWAConfigKeys.MIN_BACKING, minBacking);
        emit ConfigSet(FWAConfigKeys.CALLBACK_GAS_LIMIT, callbackGasLimit);
        emit ConfigSet(FWAConfigKeys.REQUEST_CONFIRMATIONS, requestConfirmations);
        emit ConfigSet(FWAConfigKeys.MAX_ACTIVATIONS_PER_ACQUISITION, maxActivationsPerAcquisition);
        emit ConfigSet(FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS, selectionTimeoutBlocks);
        emit ConfigSet(FWAConfigKeys.ACQUISITIONS_ENABLED, 0); // deploys in the loading phase
        emit ConfigSet(FWAConfigKeys.WHITELIST_ENABLED, 1); // only whitelisted collections may deposit
        emit ConfigSet(FWAConfigKeys.PAYOUT_ADDRESS, uint256(uint160(payoutAddress)));
        emit ConfigSet(FWAConfigKeys.TOP_LISTING_SHARE_BPS, topListingShareBps);
        emit ConfigSet(FWAConfigKeys.TOP_THRESHOLD_BPS, topThresholdBps);
        emit ConfigSet(FWAConfigKeys.RETAINED_TO_PROTOCOL, retainedToProtocol ? 1 : 0);
    }

    /*//////////////////////////////////////////////////////////////
                           DEPOSIT AN ERC721
    //////////////////////////////////////////////////////////////*/

    /// @notice Escrow an ERC721 plus backing ETH as a listing. `msg.value` funds the depositor's
    ///         standing bid and derives inverse selection weight (`NUM / backing`).
    /// @dev Payable: the backing is held until the listing is allocated or withdrawn. The
    ///      depositor must approve this contract for the token first.
    function listNFT(address collection, uint256 tokenId) external payable nonReentrant returns (uint256 listingId) {
        listingId = _createListing(collection, tokenId, msg.sender);
    }

    /// @dev Shared listing constructor for `listNFT` (`pullFrom = msg.sender`) and `relistNFT`
    ///      (`pullFrom = address(this)`: the NFT is already in custody from the won listing, so the
    ///      pull is skipped). Applies the full new-deposit gauntlet and the staging-queue
    ///      anti-steering branch identically for both entry points. `msg.sender` is the new
    ///      depositor and `msg.value` the backing. NOTE: `pullFrom` is deliberately a runtime
    ///      address (not a bool flag) so via-IR's function specializer doesn't clone this body
    ///      per call site — the bytecode budget can't afford two copies.
    function _createListing(address collection, uint256 tokenId, address pullFrom)
        internal
        returns (uint256 listingId)
    {
        if (withdrawOnly) revert WithdrawOnlyActive();
        // Deposits remain allowed with acquisitions in flight, but they stage outside the tree and
        // cannot affect an already-issued request's committed selection input.
        if (msg.value == 0) revert ZeroBacking();
        if (msg.value < minBacking) revert BelowMinBacking();
        if (collection.code.length == 0) revert InvalidCollection();
        if (whitelistEnabled && !collectionWhitelisted[collection]) revert CollectionNotWhitelisted();

        uint256 value = msg.value;
        // Acquisition selection weight are INVERSELY proportional to the backing: weight = NUM / value, so a
        // cheaper listing is more likely to be allocated and a richer one less likely.
        uint256 weight = INVERSE_WEIGHT_NUMERATOR / value;
        if (weight == 0) revert BackingTooHigh();

        if (pullFrom != address(this)) {
            /*
                Using transferFrom deliberately instead of safeTransferFrom:

                1. The destination is this known contract.
                2. We do not need an ERC721 receiver callback.
                3. Random safe transfers sent directly to this contract revert
                   instead of becoming untracked listings.

                User must approve this contract first.
            */
            ERC721(collection).transferFrom(pullFrom, address(this), tokenId);

            // Optional defensive check for unusual NFT implementations.
            if (ERC721(collection).ownerOf(tokenId) != address(this)) {
                revert NFTTransferFailed();
            }
        }

        listingId = nextListingId++;

        // Fee-distribution share key: a flat 1, so acquisition fees split equally per active listing. The
        // size incentive the old √value weighting carried now lives in the separate top-listing
        // topListingShare. Fixed here so it never has to be recomputed (a re-price keeps the same share).
        uint256 feeShare = 1;

        // Record the listing's immutable economic fields now. Pool and rewards checkpoints are taken
        // only at activation, so a staged listing earns nothing before it joins the selectable pool.
        listings[listingId] = Listing({
            collection: collection,
            depositor: msg.sender,
            purchaser: address(0),
            tokenId: tokenId,
            weight: weight,
            value: value,
            feeShare: feeShare,
            feeDebt: 0,
            slot: 0,
            allocatedAt: 0,
            status: ListingStatus.Active // provisional — set precisely in the branch below
        });
        // With no unresolved acquisition and no older staging backlog, activate immediately. Otherwise
        // append to staging. A request issued later may reserve it, but every already-issued request has
        // already committed its exact batch and can never observe this new input.
        if (unsettledAcquisitionCount == 0 && stagingHead == 0) {
            _activateListing(listingId);
        } else {
            if (maxStagedListings != 0 && stagedCount >= maxStagedListings) revert StagingQueueFull();
            listings[listingId].status = ListingStatus.Staged;
            _stagingPush(listingId);
            emit ListingStaged(listingId, msg.sender, collection, tokenId, value, block.number);

            // Preserve FIFO if an old unreserved tail survived the last acquisition window: a fresh
            // listing never leapfrogs it merely because the pool is currently idle.
            if (unsettledAcquisitionCount == 0) _drainStaging(maxActivationsPerAcquisition);
        }
    }

    /*//////////////////////////////////////////////////////////////
                          STAGING QUEUE
    //////////////////////////////////////////////////////////////*/

    /// @notice Permissionlessly activate up to `maxCount` unreserved FIFO listings while no acquisition
    ///         remains unresolved. During a window, only the ordered processor may activate the exact
    ///         request-time batches.
    function activateListings(uint256 maxCount) external nonReentrant {
        if (unsettledAcquisitionCount != 0) return;
        _drainStaging(maxCount);
    }

    /// @dev Move a listing — fresh, idle-drained, or from a request's reserved batch — into the active
    ///      selection pool: take its fee/reward checkpoints against the
    ///      CURRENT indices (ceil, so it never over-credits), assign a tree slot, add its weight and pool
    ///      totals, and run the top-spot take/seize. Emits `NFTListed` at go-live (the point its `slot`
    ///      exists), mirroring the original single-step deposit.
    function _activateListing(uint256 listingId) internal {
        Listing storage listing = listings[listingId];

        uint256 value = listing.value;
        uint256 weight = listing.weight;
        uint256 feeShare = listing.feeShare;
        // Ceil the fee checkpoint so this listing can never receive fees distributed before activation.
        listing.feeDebt = (feeShare * accFeePerEV + SCALE - 1) / SCALE;

        uint256 slot = _allocateSlot();
        listing.slot = slot;
        slotToListing[slot] = listingId;

        _addTreeWeight(slot, weight);
        totalWeight += weight;
        weightedBackingTotal += weight * value;
        activeBackingTotal += value;
        feeShareTotal += feeShare;
        activeListingCount++;

        listing.status = ListingStatus.Active;

        IFWARewards r = rewards;
        if (address(r) != address(0)) r.onListingActivated(listingId, listing.depositor, value);

        // Take a vacant top with no threshold (so the pool always has a top listing once non-empty and
        // the topListingShare never strands); otherwise auto-seize when this listing clears the standing
        // top by `topThresholdBps`, settling the outgoing holder's pot. Same bar as `claimTopSpot`.
        uint256 currentTop = topListingId;
        if (currentTop == 0) {
            _setTop(listingId);
        } else if (currentTop != listingId && _beatsTop(value, currentTop)) {
            _vacateTop();
            _setTop(listingId);
        }

        emit NFTListed(listingId, slot, listing.depositor, listing.collection, listing.tokenId, weight, value);
    }

    /// @dev Activate an unreserved FIFO prefix. Only callable through paths that have established there
    ///      is no unresolved acquisition, so block maturity is unnecessary: sequence commitment is the
    ///      anti-steering boundary.
    function _drainStaging(uint256 maxCount) internal {
        uint256 drained = 0;
        while (drained < maxCount) {
            uint256 head = stagingHead;
            if (head == 0) return;

            _stagingUnlink(head);
            _activateListing(head);
            unchecked {
                drained++;
            }
        }
    }

    /// @dev Detach the exact next FIFO batch before requesting randomness. Listings remain `Staged`
    ///      but no public queue operation can reach them; only their owning sequence can activate them.
    function _reserveStagedBatch(uint64 sequence) internal returns (uint256 count) {
        uint256 maxCount = maxActivationsPerAcquisition;
        while (count < maxCount) {
            uint256 head = stagingHead;
            if (head == 0) break;

            _stagingUnlink(head);
            reservedForSequence[head] = sequence;
            reservedListingsBySequence[sequence].push(head);
            unchecked {
                ++reservedStagedCount;
                ++count;
            }
        }
    }

    /// @dev Activate exactly the batch committed by `sequence`. Called on success and every refund /
    ///      expiry path so timeout changes only the missing random removal, never the staged prefix.
    function _activateReservedBatch(uint64 sequence) internal {
        uint256[] storage batch = reservedListingsBySequence[sequence];
        uint256 length = batch.length;
        for (uint256 i = 0; i < length; i++) {
            uint256 listingId = batch[i];
            if (reservedForSequence[listingId] != sequence || listings[listingId].status != ListingStatus.Staged) {
                revert SequenceInvariantBroken();
            }
            delete reservedForSequence[listingId];
            unchecked {
                --reservedStagedCount;
            }
            _activateListing(listingId);
        }
        delete reservedListingsBySequence[sequence];
    }

    function reservedListingCount(uint64 sequence) external view returns (uint256) {
        return reservedListingsBySequence[sequence].length;
    }

    function reservedListingAt(uint64 sequence, uint256 index) external view returns (uint256) {
        return reservedListingsBySequence[sequence][index];
    }

    /// @dev Push a listing onto the tail of the staging FIFO (doubly-linked).
    function _stagingPush(uint256 listingId) internal {
        uint256 tail = stagingTail;
        stagingPrev[listingId] = tail;
        stagingNext[listingId] = 0;
        if (tail == 0) {
            stagingHead = listingId;
        } else {
            stagingNext[tail] = listingId;
        }
        stagingTail = listingId;
        unchecked {
            ++stagedCount;
        }
    }

    /// @dev Unlink a listing from the staging FIFO in O(1), so reservation / idle activation leaves
    ///      no tombstone for a later prefix walk to scan.
    function _stagingUnlink(uint256 listingId) internal {
        uint256 prev = stagingPrev[listingId];
        uint256 next = stagingNext[listingId];
        if (prev == 0) {
            stagingHead = next;
        } else {
            stagingNext[prev] = next;
        }
        if (next == 0) {
            stagingTail = prev;
        } else {
            stagingPrev[next] = prev;
        }
        delete stagingPrev[listingId];
        delete stagingNext[listingId];
        unchecked {
            --stagedCount;
        }
    }

    /*//////////////////////////////////////////////////////////////
                          WITHDRAW ACTIVE LISTING
    //////////////////////////////////////////////////////////////*/

    /// @dev Withdrawing, repricing, moving the top, or publicly activating listings could change an
    ///      already-issued draw. Keep them locked until every issued sequence is terminal, including
    ///      after its word has been cached but before the ordered processor reaches it.
    function _requireExitUnlocked() internal view {
        if (unsettledAcquisitionCount != 0) revert WithdrawLocked();
    }

    /// @notice Withdraw an active listing you deposited: returns the NFT, its backing ETH, and
    ///         settles any acquisition-fee share it accrued into your withdrawable earnings.
    /// @dev Load `listingId` and require it Active and deposited by `msg.sender`. Shared guard
    ///      prologue of every depositor-facing action on a live listing.
    function _activeOwned(uint256 listingId) internal view returns (Listing storage listing) {
        listing = listings[listingId];
        if (listing.status != ListingStatus.Active) revert ListingNotActive();
        if (listing.depositor != msg.sender) revert NotDepositor();
    }

    function withdrawListing(uint256 listingId) external nonReentrant {
        // Exit gate: a withdrawal removes weight from the tree, which could steer a live acquisition, so
        // it is blocked while an honorable VRF word could still exist (see `_requireExitUnlocked`).
        _requireExitUnlocked();

        Listing storage listing = _activeOwned(listingId);

        uint256 value = listing.value;
        address collection = listing.collection;
        uint256 tokenId = listing.tokenId;

        /*
            Effects before interaction. Settle the listing's accrued fees to the depositor's
            credit, then remove its weight/EV from the pool and free its slot.
        */
        _settleAndRemove(listingId);

        // If this listing held the top, settle its top-listing pot to the depositor and vacate.
        // The depositor banks both their normal fee share (above) and the accrued pot.
        if (topListingId == listingId) _vacateTop();

        listing.status = ListingStatus.Withdrawn;

        SafeTransferLib.forceSafeTransferETH(msg.sender, value);
        ERC721(collection).safeTransferFrom(address(this), msg.sender, tokenId);

        emit ListingWithdrawn(listingId, msg.sender, value);
    }

    /*//////////////////////////////////////////////////////////////
                          UPDATE LISTING BACKING
    //////////////////////////////////////////////////////////////*/

    /// @notice Change the backing ETH on one of your active listings, which also re-prices its inverse
    ///         selection weight (`weight = NUM / value`). Its equal-per-listing fee share stays one. Send the shortfall as
    ///         `msg.value` to increase; any overpayment and any freed backing on a decrease are
    ///         refunded in the same call.
    /// @dev A value change alters the selection weight and pool value a pending purchaser paid against —
    ///      exactly like a withdrawal — so it respects the same exit gate (`_requireExitUnlocked`), in
    ///      BOTH directions (an increase steers just as a decrease does). Increases add capital, so they
    ///      are additionally halted in `withdrawOnly`; decreases return capital and are allowed once the
    ///      gate clears. Accrued fees are settled at the OLD share before the share changes, then the fee
    ///      checkpoint is reset against the new share, so the dividend accounting stays exact.
    /// @param listingId The active listing to re-price.
    /// @param newBacking The new backing ETH for the listing.
    function updateBacking(uint256 listingId, uint256 newBacking) external payable nonReentrant {
        Listing storage listing = _activeOwned(listingId);

        if (newBacking < minBacking) revert BelowMinBacking();
        if (newBacking == 0) revert ZeroBacking();

        uint256 oldBacking = listing.value;
        // Increases add capital (deposit-like): halted in emergency withdraw-only mode.
        if (newBacking > oldBacking && withdrawOnly) revert WithdrawOnlyActive();
        // Exit gate: a re-price in EITHER direction moves this listing's weight and the pool value a
        // pending purchaser paid against, so — like a withdrawal — it is blocked while an honorable VRF
        // word could still exist.
        _requireExitUnlocked();

        uint256 newWeight = INVERSE_WEIGHT_NUMERATOR / newBacking;
        if (newWeight == 0) revert BackingTooHigh();

        // Net ETH the depositor must cover is `newBacking - oldBacking`; everything else returns.
        // refund = msg.value - (newBacking - oldBacking), kept non-negative by the check below.
        if (msg.value + oldBacking < newBacking) revert InsufficientPayment();
        uint256 refund = msg.value + oldBacking - newBacking;

        // Settle accrued fees at the OLD share before it changes, so the dividend math is exact;
        // mirrors `_settleAndRemove`. The depositor withdraws the credit via `withdrawEarnings`.
        uint256 pending = _pendingFees(listing);
        if (pending != 0) {
            feeCredit[msg.sender] += pending;
            emit EarningsAccrued(msg.sender, listingId, pending);
        }

        IFWARewards r = rewards;
        if (address(r) != address(0)) r.onListingRepriced(listingId, newBacking);

        // Re-weight the tree and pool totals by the deltas (exact: we use the stored old fields).
        uint256 oldWeight = listing.weight;
        uint256 slot = listing.slot;
        if (newWeight > oldWeight) {
            _addTreeWeight(slot, newWeight - oldWeight);
        } else if (newWeight < oldWeight) {
            _removeTreeWeight(slot, oldWeight - newWeight);
        }
        totalWeight = totalWeight - oldWeight + newWeight;
        weightedBackingTotal = weightedBackingTotal - oldWeight * oldBacking + newWeight * newBacking;
        activeBackingTotal = activeBackingTotal - oldBacking + newBacking;

        // Equal weighting: a listing's share is a flat 1 regardless of value, so a re-price leaves the
        // share (and `feeShareTotal`) unchanged. Kept in delta form to stay robust if the share
        // basis ever changes again. (Top bookkeeping for the re-price runs after the writes below.)
        uint256 newFeeShare = 1;
        feeShareTotal = feeShareTotal - listing.feeShare + newFeeShare;

        // Write the new fields and re-checkpoint the fee debt against the new share (ceil, as in
        // `listNFT`, so the listing is never credited more than its true future share).
        listing.value = newBacking;
        listing.weight = newWeight;
        listing.feeShare = newFeeShare;
        listing.feeDebt = (newFeeShare * accFeePerEV + SCALE - 1) / SCALE;

        // Top bookkeeping on a re-price:
        //  - This listing already holds the top: a strict decrease forfeits it (vacate, settling the
        //    pot back to the holder) — reducing your committed backing gives up the title, mirroring
        //    a withdraw. A raise (or no change) keeps the top and its in-progress pot intact.
        //  - Someone else holds it: a raise clearing the bar by `topThresholdBps` auto-seizes it,
        //    settling the outgoing holder's pot — mirroring `listNFT`.
        //  - Vacant top: left for deposits / `claimTopSpot` to fill.
        uint256 currentTop = topListingId;
        if (currentTop == listingId) {
            if (newBacking < oldBacking) _vacateTop();
        } else if (currentTop != 0 && _beatsTop(newBacking, currentTop)) {
            _vacateTop();
            _setTop(listingId);
        }

        emit BackingUpdated(listingId, msg.sender, oldBacking, newBacking, newWeight);

        if (refund != 0) SafeTransferLib.forceSafeTransferETH(msg.sender, refund);
    }

    /*//////////////////////////////////////////////////////////////
                            CLAIM THE TOP
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim the top-listing top for one of your active listings. If the top is vacant the
    ///         first active recipient takes it with no threshold; otherwise your listing's backing must be
    ///         at least the current top's value × (1 + `topThresholdBps`/BPS). On a takeover the
    ///         outgoing holder's accrued pot settles to their `feeCredit` and the pot resets for you.
    /// @dev This is how an already-active larger listing — or one that raised its value via
    ///      `updateBacking` — seizes the top. Effects-only (credits `feeCredit`, no ETH transfer),
    ///      but kept `nonReentrant` for consistency with the other state-changing externals.
    /// @param listingId The active listing of yours to top.
    function claimTopSpot(uint256 listingId) external nonReentrant {
        Listing storage listing = _activeOwned(listingId);

        uint256 currentId = topListingId;

        // Already holding the top: no-op. This guard is load-bearing — without it the vacate below
        // would settle (and zero) this listing's own in-progress pot and then re-top it, wiping the
        // holder's accrued topListingShare.
        if (currentId == listingId) return;

        if (currentId != 0) {
            if (!_beatsTop(listing.value, currentId)) revert TopNotBeaten();
            _vacateTop(); // settle the outgoing holder's pot, clear the top
        }

        _setTop(listingId);
    }

    /*//////////////////////////////////////////////////////////////
                             REQUEST A ACQUISITION
    //////////////////////////////////////////////////////////////*/

    /// @notice The external VRF service's purchaser charge for one request.
    /// @dev Relies on `tx.gasprice`; quote via an `eth_call` using the intended transaction gas price.
    function vrfServiceFee() public view returns (uint256) {
        return vrfService.requestFee();
    }

    /// @notice The expected-value-based fee an acquisition costs the depositor pool right now. With
    ///         inverse selection weight the EV is the harmonic mean of the pool's values, so a pool of
    ///         richer listings prices cheaper — you're far more likely to acquisition a low-value listing.
    /// @return acquisitionFee The pool fee, `EV · (1 + surcharge)`, shared among depositors.
    function acquisitionFee() public view returns (uint256) {
        if (totalWeight == 0) return 0;
        uint256 ev = weightedBackingTotal / totalWeight;
        return ev * (BPS + surchargeBps) / BPS;
    }

    /// @notice Quote the full native cost of an acquisition: the depositor pool fee plus the VRF service fee.
    /// @return fee The depositor pool fee.
    /// @return vrf The VRF service fee (recoups the subscription's fulfillment gas).
    /// @return total `fee + vrf`, the minimum `msg.value` for `acquire`.
    function quoteAcquisitionPrice() external view returns (uint256 fee, uint256 vrf, uint256 total) {
        fee = acquisitionFee();
        vrf = vrfServiceFee();
        total = fee + vrf;
    }

    /// @notice Pay for and request a VRF acquisition against the current listing pool. Send at least
    ///         `quoteAcquisitionPrice().total`; any excess is refunded. Requests are fully concurrent,
    ///         while their cached words settle strictly in the local sequence assigned on-chain.
    /// @dev The acquisition fee remains escrowed until ordered processing distributes it or converts it
    ///      to a pull refund. The separate VRF fee is forwarded before requesting randomness, allowing
    ///      the service to fund callback coverage without touching backing or depositor fees.
    /// @param maxAcquisitionFee Slippage guard: revert if the pool fee exceeds this. `0` disables
    ///        the check. Protects the purchaser from a deposit front-running the request and
    ///        raising the price under them.
    /// @param minWeightedValue Slippage guard: revert if `weightedBackingTotal` is below this.
    ///        `0` disables the check. Protects the purchaser from a withdrawal front-running the
    ///        request and pulling listing value out of the pool they paid to acquisition against.
    function acquire(uint256 maxAcquisitionFee, uint256 minWeightedValue)
        external
        payable
        nonReentrant
        returns (uint256 requestId)
    {
        requestId = _acquire(maxAcquisitionFee, minWeightedValue, selectionSlippageBps);
    }

    /// @notice Request an acquisition while choosing the maximum negative settlement drift you accept.
    ///         Positive drift remains capped by the protocol's snapshotted `selectionSlippageBps`.
    function acquire(uint256 maxAcquisitionFee, uint256 minWeightedValue, uint256 maxNegativeSlippageBps)
        external
        payable
        nonReentrant
        returns (uint256 requestId)
    {
        requestId = _acquire(maxAcquisitionFee, minWeightedValue, maxNegativeSlippageBps);
    }

    function _acquire(uint256 maxAcquisitionFee, uint256 minWeightedValue, uint256 maxNegativeSlippageBps)
        internal
        returns (uint256 requestId)
    {
        if (maxNegativeSlippageBps > BPS) revert InvalidConfig();
        if (unsettledAcquisitionCount == 0) _drainStaging(maxActivationsPerAcquisition);

        uint256 fee = _validateAcquisition(maxAcquisitionFee, minWeightedValue);

        uint256 vrf = vrfServiceFee();
        uint256 cost = fee + vrf;
        if (msg.value < cost) revert InsufficientPayment();

        // Effects in the service (including any subscription top-up) roll back if the later VRF request fails.
        vrfService.prepareRequests{value: vrf}(1);
        emit VrfServiceFeePaid(msg.sender, vrf);

        requestId = _openAcquisition(fee, maxNegativeSlippageBps);

        // Refund any overpayment above the pool fee + VRF service fee.
        _refund(msg.value - cost);
    }

    /// @notice Acquisition `count` times in one call: fires `count` independent VRF requests (one callback
    ///         each), every one priced, escrowed, settled and slippage-checked exactly like a single
    ///         `acquire`. You pay `count * (acquisitionFee + vrfFee)`; overpayment is refunded. The pool
    ///         is static during this request, so the slippage guards are checked once for all `count`;
    ///         each acquisition re-checks drift at its own ordered processing turn. Note: only the first acquisition of a batch
    ///         earns the cold-gap FWAToken surcharge slice — the rest are "hot" (gap 0), so batching can't farm
    ///         that bonus.
    function acquireBatch(uint256 count, uint256 maxAcquisitionFee, uint256 minWeightedValue)
        external
        payable
        nonReentrant
        returns (uint256[] memory requestIds)
    {
        requestIds = _acquireBatch(count, maxAcquisitionFee, minWeightedValue, selectionSlippageBps);
    }

    function acquireBatch(
        uint256 count,
        uint256 maxAcquisitionFee,
        uint256 minWeightedValue,
        uint256 maxNegativeSlippageBps
    ) external payable nonReentrant returns (uint256[] memory requestIds) {
        requestIds = _acquireBatch(count, maxAcquisitionFee, minWeightedValue, maxNegativeSlippageBps);
    }

    function _acquireBatch(
        uint256 count,
        uint256 maxAcquisitionFee,
        uint256 minWeightedValue,
        uint256 maxNegativeSlippageBps
    ) internal returns (uint256[] memory requestIds) {
        if (count == 0 || count > maxAcquisitionsPerTx) revert InvalidAcquisitionCount();
        if (maxNegativeSlippageBps > BPS) revert InvalidConfig();

        if (unsettledAcquisitionCount == 0) _drainStaging(count * maxActivationsPerAcquisition);

        uint256 fee = _validateAcquisition(maxAcquisitionFee, minWeightedValue);

        uint256 vrf = vrfServiceFee();
        uint256 cost = count * (fee + vrf);
        if (msg.value < cost) revert InsufficientPayment();

        uint256 vrfTotal = count * vrf;
        // Reserve all batch callbacks before request #1. The whole transaction is atomic if any request fails.
        vrfService.prepareRequests{value: vrfTotal}(count);
        emit VrfServiceFeePaid(msg.sender, vrfTotal);

        requestIds = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            requestIds[i] = _openAcquisition(fee, maxNegativeSlippageBps);
        }

        _refund(msg.value - cost);
    }

    /// @dev Shared acquisition precondition + slippage checks. Returns the current `acquisitionFee()`. Reverts if
    ///      acquisitions are disabled, the pool is empty, the pool value drifted below `minWeightedValue`, or
    ///      the fee exceeds `maxAcquisitionFee`.
    function _validateAcquisition(uint256 maxAcquisitionFee, uint256 minWeightedValue)
        internal
        view
        returns (uint256 fee)
    {
        if (withdrawOnly) revert WithdrawOnlyActive();
        if (!acquisitionsEnabled) revert AcquisitionsNotEnabled(); // still in the loading phase
        if (totalWeight == 0) revert NoActiveListings();

        // Slippage guards: assert the pool the purchaser saw hasn't shifted under them before
        // this request is mined.
        if (minWeightedValue != 0 && weightedBackingTotal < minWeightedValue) revert PoolValueTooLow();

        fee = acquisitionFee();
        if (maxAcquisitionFee != 0 && fee > maxAcquisitionFee) revert AcquisitionFeeTooHigh();
    }

    /// @dev Open one VRF-backed acquisition, commit its local sequence/batch, and register any optional
    ///      token reward in the external rewards module.
    function _openAcquisition(uint256 fee, uint256 maxNegativeSlippageBps) internal returns (uint256 requestId) {
        uint64 sequence = ++lastIssuedSequence;
        uint256 reservedCount = _reserveStagedBatch(sequence);
        uint64 deadline = uint64(block.number + selectionTimeoutBlocks);

        // The sequence and exact staged batch are committed before the external VRF request. If the
        // coordinator reverts, the entire transaction rolls both commitments back.
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: true}))
            })
        );
        if (requestId == 0 || acquisitions[requestId].status != AcquisitionStatus.None) {
            revert DuplicateRequestId();
        }

        acquisitions[requestId] = Acquisition({
            purchaser: msg.sender,
            requestBlock: block.number,
            priceEscrowed: fee,
            listingId: 0,
            status: AcquisitionStatus.Pending
        });

        uint256 surchargeSlice;
        uint64 rewardEpoch;
        IFWARewards r = rewards;
        if (address(r) != address(0)) {
            (surchargeSlice, rewardEpoch) = r.registerAcquisition(requestId, msg.sender, fee, surchargeBps);
            if (surchargeSlice > fee) revert InvalidConfig();
            acquisitionTokenSlice[requestId] = surchargeSlice;
        }
        acquisitionMeta[requestId] = AcquisitionMeta({
            sequence: sequence,
            wordDeadlineBlock: deadline,
            rewardEpoch: rewardEpoch,
            maxPositiveSlippageBps: uint16(selectionSlippageBps),
            maxNegativeSlippageBps: uint16(maxNegativeSlippageBps),
            randomWord: 0
        });
        requestIdAtSequence[sequence] = requestId;

        pendingAcquisitionCount += 1;
        unfulfilledVrfCount += 1;
        unsettledAcquisitionCount += 1;
        acquisitionEscrowTotal += fee;

        emit AcquisitionRequested(requestId, msg.sender, fee, totalWeight);
        emit AcquisitionSequenced(requestId, sequence, deadline, reservedCount);
    }

    /// @dev Refund overpayment above the total acquisition cost, if any.
    function _refund(uint256 amount) internal {
        if (amount != 0) SafeTransferLib.forceSafeTransferETH(msg.sender, amount);
    }

    /// @notice Single source of truth used by FWAVRFService for subscription balance reads and top-ups.
    function vrfCoordinatorAndSubId() external view returns (address coordinator, uint256 subId) {
        coordinator = address(s_vrfCoordinator);
        subId = vrfSubId;
    }

    /// @notice Current gas lane and callback budget, used by the immutable service to bind request
    ///         coverage to the exact tuple FWA will send to Chainlink.
    function vrfRequestConfig() external view returns (bytes32 keyHash, uint32 gasLimit) {
        keyHash = vrfKeyHash;
        gasLimit = callbackGasLimit;
    }

    /// @notice Change the Chainlink request tuple only through FWAVRFService's atomic coverage update.
    function configureVrfRequest(bytes32 keyHash, uint32 gasLimit) external {
        if (msg.sender != address(vrfService)) revert OnlyVrfService();
        if (acquisitionsEnabled || unsettledAcquisitionCount != 0 || unfulfilledVrfCount != 0) {
            revert AcquisitionStateLocked();
        }
        if (keyHash == bytes32(0) || gasLimit < MIN_CALLBACK_GAS_LIMIT || gasLimit > MAX_CALLBACK_GAS_LIMIT) {
            revert InvalidConfig();
        }
        vrfKeyHash = keyHash;
        callbackGasLimit = gasLimit;
        emit ConfigSet(FWAConfigKeys.VRF_KEY_HASH, uint256(keyHash));
        emit ConfigSet(FWAConfigKeys.CALLBACK_GAS_LIMIT, gasLimit);
    }

    /// @notice Clear callback liabilities that the coordinator has already completed (and potentially
    ///         billed) without a successful consumer callback. Safe only for FWA's dedicated subscription.
    /// @dev Permissionless and fail-closed: the coordinator must report that the subscription has no
    ///      remaining request commitment. Acquisition expiry/processing remains a separate ordered step.
    function reconcileUnfulfilledVrfCount() external returns (uint256 reconciled) {
        reconciled = unfulfilledVrfCount;
        if (reconciled == 0) return 0;
        if (s_vrfCoordinator.pendingRequestExists(vrfSubId)) revert VrfRequestsPending();
        unfulfilledVrfCount = 0;
        emit UnfulfilledVrfReconciled(reconciled);
    }

    /*//////////////////////////////////////////////////////////////
                           CHAINLINK CALLBACK
    //////////////////////////////////////////////////////////////*/

    /// @notice VRF v2.5 fulfillment entrypoint. The coordinator is the ONLY authorized caller — this is
    ///         the hand-rolled equivalent of the Chainlink base's `rawFulfillRandomWords` (we don't
    ///         inherit the base; see the contract header). It caches or rejects the delivered word first,
    ///         then may make one failure-isolated attempt to process the canonical head.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(s_vrfCoordinator)) revert OnlyCoordinator();
        fulfillRandomWords(requestId, randomWords);
    }

    /// @dev Coordinator callback: cache an on-time word or permanently classify it late. Unknown,
    ///      duplicate, terminal and malformed fulfillments return without reverting. Fast-path settlement
    ///      is best effort only; its child failure cannot roll back the cached word.
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal {
        Acquisition storage acquisition = acquisitions[requestId];

        // Chainlink bills when the authenticated callback is attempted, even if this acquisition already
        // expired locally or the word array is malformed. Release its external coverage exactly once only
        // for a request this FWA actually issued. Unknown and duplicate callbacks remain harmless.
        if (acquisition.status != AcquisitionStatus.None && !callbackObserved[requestId]) {
            callbackObserved[requestId] = true;
            uint256 count = unfulfilledVrfCount;
            if (count != 0) unfulfilledVrfCount = count - 1;
        }

        if (acquisition.status != AcquisitionStatus.Pending) {
            emit FulfillmentIgnored(requestId, acquisition.status);
            return;
        }

        AcquisitionMeta storage meta = acquisitionMeta[requestId];
        if (block.number > meta.wordDeadlineBlock) {
            acquisition.status = AcquisitionStatus.TimedOut;
            pendingAcquisitionCount -= 1;
            emit RandomnessTimedOut(requestId, meta.sequence, meta.wordDeadlineBlock, block.number);
            return;
        }

        if (randomWords.length == 0) {
            emit FulfillmentIgnored(requestId, acquisition.status);
            return;
        }

        meta.randomWord = randomWords[0];
        acquisition.status = AcquisitionStatus.Ready;
        pendingAcquisitionCount -= 1;
        emit RandomnessCached(requestId, meta.sequence, randomWords[0]);

        _tryProcessCallbackHead(meta.sequence);
    }

    /// @dev Best-effort fast path. The word and callback-liability effects are committed in the parent
    ///      frame before this function runs. The child call reuses the exact permissionless processor,
    ///      including its reentrancy guard; any OOG, invariant failure, or rewards-module revert rolls
    ///      back only the child frame and leaves this acquisition `Ready` for a later processor.
    ///      Return data is deliberately not copied, preventing a reverting callee from consuming the
    ///      parent's return reserve with an oversized revert payload.
    function _tryProcessCallbackHead(uint64 sequence) internal {
        if (
            callbackGasLimit < MIN_FAST_PATH_CALLBACK_GAS_LIMIT || sequence != nextSequenceToProcess
                || reservedListingsBySequence[sequence].length != 0
        ) return;

        if (gasleft() < CALLBACK_FAST_PATH_GAS + CALLBACK_RETURN_GAS_RESERVE) {
            return;
        }

        bytes memory callData = abi.encodeCall(this.processAcquisitions, (1));
        uint256 gasStipend = CALLBACK_FAST_PATH_GAS;
        assembly ("memory-safe") {
            pop(call(gasStipend, address(), 0, add(callData, 0x20), mload(callData), 0, 0))
        }
    }

    /// @notice Process the canonical ready/expired acquisition prefix. The caller chooses only a gas
    ///         batching bound; request IDs and ordering are fixed by `nextSequenceToProcess`.
    function processAcquisitions(uint256 maxCount) external nonReentrant returns (uint256 processed) {
        while (processed < maxCount && nextSequenceToProcess <= lastIssuedSequence) {
            uint64 sequence = nextSequenceToProcess;
            uint256 requestId = requestIdAtSequence[sequence];
            Acquisition storage acquisition = acquisitions[requestId];
            AcquisitionMeta storage meta = acquisitionMeta[requestId];
            if (requestId == 0 || meta.sequence != sequence) revert SequenceInvariantBroken();

            AcquisitionStatus status = acquisition.status;
            if (status == AcquisitionStatus.Pending) {
                if (block.number <= meta.wordDeadlineBlock) break;
                pendingAcquisitionCount -= 1;
                _activateReservedBatch(sequence);
                uint256 refund = _creditAcquisitionRefund(acquisition, AcquisitionStatus.Expired);
                emit AcquisitionExpired(requestId, sequence, acquisition.purchaser, refund);
            } else if (status == AcquisitionStatus.TimedOut) {
                _activateReservedBatch(sequence);
                uint256 refund = _creditAcquisitionRefund(acquisition, AcquisitionStatus.Expired);
                emit AcquisitionExpired(requestId, sequence, acquisition.purchaser, refund);
            } else if (status == AcquisitionStatus.Ready) {
                _activateReservedBatch(sequence);
                _settleReadyAcquisition(requestId, acquisition, meta);
            } else {
                revert SequenceInvariantBroken();
            }

            _finishAcquisition(requestId, acquisition, meta, msg.sender);
            unchecked {
                ++nextSequenceToProcess;
                ++processed;
            }
        }
    }

    function _creditAcquisitionRefund(Acquisition storage acquisition, AcquisitionStatus status)
        internal
        returns (uint256 refund)
    {
        refund = acquisition.priceEscrowed;
        acquisition.status = status;
        acquisitionRefundCredit[acquisition.purchaser] += refund;
        acquisitionRefundCreditTotal += refund;
    }

    function _finishAcquisition(
        uint256 requestId,
        Acquisition storage acquisition,
        AcquisitionMeta storage meta,
        address processor
    ) internal {
        IFWARewards r = rewards;
        uint256 slice = acquisitionTokenSlice[requestId];
        delete acquisitionTokenSlice[requestId];
        acquisitionEscrowTotal -= acquisition.priceEscrowed;
        unsettledAcquisitionCount -= 1;

        if (address(r) != address(0)) {
            if (acquisition.status == AcquisitionStatus.Fulfilled) {
                r.settleAcquisition{value: slice}(requestId);
            } else {
                r.refundAcquisition(requestId);
            }
        }
        emit AcquisitionProcessed(requestId, meta.sequence, acquisition.status, processor);
    }

    /// @dev Settle a cached word against the pool after its immutable activation batch is applied.
    function _settleReadyAcquisition(uint256 requestId, Acquisition storage acquisition, AcquisitionMeta storage meta)
        internal
    {
        /*
            Empty pool: earlier canonical sequences removed every listing, so nothing can be selected.
            Convert the purchaser's escrowed acquisition fee into a pull credit without any external call.
        */
        if (totalWeight == 0) {
            uint256 refund = _creditAcquisitionRefund(acquisition, AcquisitionStatus.Refunded);
            emit AcquisitionRefundedNoListing(requestId, acquisition.purchaser, refund);
            return;
        }

        /*
            Ordered-settlement slippage guard: re-price against the canonical live pool after this
            sequence's immutable reserved batch is activated. Earlier sequences may have removed listings
            and shifted the fee. Drift outside the request's snapshotted tolerances becomes a pull refund;
            the would-be selected listing remains active.
        */
        {
            uint256 liveFee = acquisitionFee();
            uint256 escrowed = acquisition.priceEscrowed;
            uint256 positiveTolerance = escrowed * meta.maxPositiveSlippageBps / BPS;
            uint256 negativeTolerance = escrowed * meta.maxNegativeSlippageBps / BPS;
            if (
                (liveFee > escrowed && liveFee - escrowed > positiveTolerance)
                    || (liveFee < escrowed && escrowed - liveFee > negativeTolerance)
            ) {
                _creditAcquisitionRefund(acquisition, AcquisitionStatus.Refunded);
                emit AcquisitionRefundedSlippage(requestId, acquisition.purchaser, escrowed, escrowed, liveFee);
                return;
            }
        }

        /*
            Selection resolves against the canonical live pool produced by every earlier sequence plus
            this request's reserved activation batch. Find the slot whose cumulative weight range contains
            the target in TREE_DEPTH descents.
        */
        uint256 randomWord = meta.randomWord;
        uint256 target = randomWord % totalWeight;

        uint256 slot = _selectSlot(target);
        uint256 listingId = slotToListing[slot];

        if (listingId == 0) revert InvalidTreeResult();

        Listing storage listing = listings[listingId];

        if (listing.status != ListingStatus.Active) revert InvalidTreeResult();

        // The rewards module registered this immutable surcharge slice at request time. It receives the
        // ETH in `_finishAcquisition`; the remaining fee is distributed here.
        uint256 acquisitionFeePaid = acquisition.priceEscrowed;
        uint256 slice = acquisitionTokenSlice[requestId];

        // Skim the owner's protocol cut from the DEPOSITOR portion (post-slice), then route the rest
        // BEFORE removing the allocated listing, so the listing being allocated shares in the acquisition it bore selection weight for
        // (settled into its depositor's credit as it leaves the pool). The purchaser paid the same
        // fee either way.
        uint256 distributable = acquisitionFeePaid - slice;
        uint256 ownerCut = distributable * ownerAcquisitionFeeBps / BPS;
        _accrueOwnerFee(ownerCut);

        distributable -= ownerCut;

        // Cache whether the allocated listing is the top BEFORE any removal, so the ordering below is
        // robust even if `_settleAndRemove` ever changes.
        bool allocatedWasTop = topListingId == listingId;

        // Carve the top-listing topListingShare off the top and add it to the live pot (even when the top is
        // the listing being allocated — it earns this acquisition's topListingShare before being settled out). The rest is
        // split equally across active listings. With no top the topListingShare folds back into that split.
        if (topListingId != 0) {
            uint256 topListingShare = distributable * topListingShareBps / BPS;
            topListingPot += topListingShare;
            emit TopListingFunded(topListingId, topListingShare, topListingPot);
            _distribute(distributable - topListingShare);
        } else {
            _distribute(distributable);
        }

        // Settle the allocated listing's equal fee share to its depositor, then remove it from the
        // active pool (weight, EV, slot). Backing ETH stays escrowed for the claim choice.
        _settleAndRemove(listingId);

        // If the listing just allocated held the top, settle the full pot (incl. this acquisition's topListingShare) to
        // its depositor and vacate. A fresh top is taken on the next deposit / claimTopSpot.
        if (allocatedWasTop) _vacateTop();

        listing.purchaser = acquisition.purchaser;
        listing.allocatedAt = uint64(block.timestamp);
        settlementWindowAtAllocation[listingId] = uint64(settlementWindow);
        finalizeWindowAtAllocation[listingId] = uint64(finalizeWindow);
        listing.status = ListingStatus.Allocated;

        acquisition.listingId = listingId;
        acquisition.status = AcquisitionStatus.Fulfilled;

        emit NFTAllocated(requestId, listingId, acquisition.purchaser, listing.depositor, listing.value, randomWord);
    }

    /// @notice Pull acquisition fees credited by ordered expiry, empty-pool, or slippage refunds.
    function withdrawAcquisitionRefund() external nonReentrant returns (uint256 amount) {
        amount = acquisitionRefundCredit[msg.sender];
        if (amount == 0) revert NoAcquisitionRefund();
        acquisitionRefundCredit[msg.sender] = 0;
        acquisitionRefundCreditTotal -= amount;
        SafeTransferLib.forceSafeTransferETH(msg.sender, amount);
        emit AcquisitionRefundWithdrawn(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                          PURCHASER RESOLUTION
    //////////////////////////////////////////////////////////////*/

    /// @dev Load `listingId` and require it Allocated with `msg.sender` as its purchaser. Shared
    ///      guard prologue of the purchaser's resolution choices.
    function _allocatedByPurchaser(uint256 listingId) internal view returns (Listing storage listing) {
        listing = listings[listingId];
        if (listing.status != ListingStatus.Allocated) revert ListingNotAllocated();
        if (listing.purchaser != msg.sender) revert NotPurchaser();
    }

    /// @dev Load `listingId` and require it Allocated, deposited by `msg.sender`, and past the
    ///      purchaser's exclusive `settlementWindow`. Shared guard prologue of the depositor's
    ///      resolution choices.
    function _allocatedByDepositorAfterWindow(uint256 listingId) internal view returns (Listing storage listing) {
        listing = listings[listingId];
        if (listing.status != ListingStatus.Allocated) revert ListingNotAllocated();
        if (listing.depositor != msg.sender) revert NotDepositor();
        if (block.timestamp < uint256(listing.allocatedAt) + settlementWindowAtAllocation[listingId]) {
            revert SettlementWindowNotElapsed();
        }
    }

    /// @notice Purchaser takes the NFT. The listing's backing ETH returns to its depositor, less the
    ///         owner's protocol cut. Available the whole time the listing is allocated.
    /// @dev Purchaser-initiated, so the NFT transfer is strict: if it fails, the whole call reverts
    ///      and the purchaser can fall back to `acceptDepositorBid` rather than be committed to an
    ///      undeliverable NFT.
    function keepNFT(uint256 listingId) external nonReentrant {
        Listing storage listing = _allocatedByPurchaser(listingId);

        (address depositor, address purchaser, uint256 toDepositor) = _settleNFTToPurchaser(listingId, listing, true);
        emit NFTKept(listingId, purchaser, depositor, toDepositor);
    }

    /// @notice Purchaser takes the NFT and sells into the ETH bid: receives `settlementDiscountBps`% of the backing. The retained
    ///         remainder is routed per `retainedToProtocol`, and the NFT is purchased by
    ///         the depositor. Available the whole time the listing is allocated.
    function acceptDepositorBid(uint256 listingId) external nonReentrant {
        Listing storage listing = _allocatedByPurchaser(listingId);

        (address depositor, address purchaser, uint256 payout, uint256 retained) =
            _settleBackingToPurchaser(listingId, listing);
        SafeTransferLib.forceSafeTransferETH(purchaser, payout);
        emit DepositorBidAccepted(listingId, purchaser, depositor, payout, retained);
    }

    /// @notice Purchaser accepts the bid, but takes the settlementDiscount as FWAToken instead of ETH: the `settlementDiscountBps` ETH
    ///         that would have been paid out is used to BUY FWAToken from the pool and delivered to the
    ///         purchaser. The NFT returns to the depositor and the retained penalty is routed as usual —
    ///         identical to `acceptDepositorBid` except the purchaser's payout arrives as FWAToken.
    /// @param minOut Slippage guard on the FWAToken received.
    function acceptBidAsTokens(uint256 listingId, uint256 minOut) external nonReentrant returns (uint256 tokenOut) {
        IFWARewards r = rewards;
        if (address(r) == address(0)) revert TokenNotConfigured();
        if (!acceptBidAsTokensEnabled) revert AcceptBidAsTokensDisabled();
        Listing storage listing = _allocatedByPurchaser(listingId);

        (address depositor, address purchaser, uint256 payout, uint256 retained) =
            _settleBackingToPurchaser(listingId, listing);
        tokenOut = r.buyFor{value: payout}(purchaser, minOut);
        emit DepositorBidAcceptedAsTokens(listingId, purchaser, depositor, payout, retained, tokenOut);
    }

    /// @notice Purchaser keeps the NFT economically but immediately re-lists it as a NEW listing
    ///         with themselves as depositor at price = `msg.value` (fresh backing). The old
    ///         depositor is paid exactly as in `keepNFT` (backing less the owner cut) and the NFT
    ///         never leaves custody. The new listing runs the full deposit gauntlet and the same
    ///         staging branch as `listNFT`, so it cannot be word-informed into a live selection.
    function relistNFT(uint256 listingId) external payable nonReentrant {
        Listing storage listing = _allocatedByPurchaser(listingId);

        (,, uint256 toDepositor) = _payoutBackingToDepositor(listing);
        uint256 newListingId = _createListing(listing.collection, listing.tokenId, address(this));
        emit NFTRelisted(listingId, newListingId, toDepositor);
    }

    /// @notice Once the purchaser's `settlementWindow` lapses without a choice, the depositor may resolve
    ///         the listing themselves and KEEP THE ETH: they receive the backing (less the owner
    ///         cut) and the NFT goes to the purchaser — identical economics to `keepNFT`.
    function depositorReclaimBacking(uint256 listingId) external nonReentrant {
        Listing storage listing = _allocatedByDepositorAfterWindow(listingId);

        (address depositor, address purchaser, uint256 toDepositor) = _settleNFTToPurchaser(listingId, listing, false);
        emit NFTKept(listingId, purchaser, depositor, toDepositor);
        emit DepositorTimeoutResolved(listingId, depositor, false);
    }

    /// @notice Once the purchaser's `settlementWindow` lapses without a choice, the depositor may resolve
    ///         the listing themselves and RECLAIM THE NFT: the purchaser gets the `settlementDiscountBps`% ETH
    ///         payout (retained remainder routed per `retainedToProtocol`) and the NFT returns to
    ///         the depositor — identical economics to `acceptDepositorBid`.
    function depositorReclaimNFT(uint256 listingId) external nonReentrant {
        Listing storage listing = _allocatedByDepositorAfterWindow(listingId);

        (address depositor, address purchaser, uint256 payout, uint256 retained) =
            _settleBackingToPurchaser(listingId, listing);
        SafeTransferLib.forceSafeTransferETH(purchaser, payout);
        emit DepositorBidAccepted(listingId, purchaser, depositor, payout, retained);
        emit DepositorTimeoutResolved(listingId, depositor, true);
    }

    /// @notice After `finalizeWindow` lapses with neither the purchaser nor the depositor resolving,
    ///         anyone may finalize the default: the NFT goes to the purchaser and the backing ETH
    ///         returns to the depositor (less the owner's protocol cut), so neither asset locks.
    function finalizeUnsettled(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.status != ListingStatus.Allocated) revert ListingNotAllocated();
        if (block.timestamp < uint256(listing.allocatedAt) + finalizeWindowAtAllocation[listingId]) {
            revert SettlementWindowNotElapsed();
        }

        (address depositor, address purchaser,) = _settleNFTToPurchaser(listingId, listing, false);
        emit UnsettledFinalized(listingId, purchaser, depositor);
    }

    /// @notice Pull an NFT whose delivery failed during resolution (e.g. a pausable, reverting, or
    ///         otherwise misbehaving collection). Only the recipient the NFT was owed to may
    ///         claim it; every ETH leg already settled when the listing resolved. Reverts if the
    ///         collection is still failing — the recipient can simply retry once it recovers.
    function recoverStuckNFT(uint256 listingId) external nonReentrant {
        if (stuckNFTRecipient[listingId] != msg.sender) revert NotStuckRecipient();

        // Cleared before the transfer; if the transfer reverts, the revert restores it and the
        // recipient stays entitled to retry.
        delete stuckNFTRecipient[listingId];

        Listing storage listing = listings[listingId];
        ERC721(listing.collection).transferFrom(address(this), msg.sender, listing.tokenId);

        emit StuckNFTRecovered(listingId, msg.sender);
    }

    /// @dev NFT-to-purchaser resolution shared by `keepNFT`, `depositorReclaimBacking`, and
    ///      `finalizeUnsettled`. Marks the listing Settled, returns the backing to the depositor
    ///      less the owner's protocol cut, and sends the NFT to the purchaser. `strict` makes the NFT
    ///      transfer revert on failure (purchaser-initiated `keepNFT`, which has a `acceptDepositorBid`
    ///      fallback); otherwise it is delivered best-effort so a misbehaving NFT can neither
    ///      block the depositor's ETH return nor lock the listing. The caller emits.
    function _settleNFTToPurchaser(uint256 listingId, Listing storage listing, bool strict)
        internal
        returns (address depositor, address purchaser, uint256 toDepositor)
    {
        (depositor, purchaser, toDepositor) = _payoutBackingToDepositor(listing);

        if (strict) {
            ERC721(listing.collection).safeTransferFrom(address(this), purchaser, listing.tokenId);
        } else {
            _deliverNFT(listingId, listing.collection, purchaser, listing.tokenId);
        }
    }

    /// @dev Settlement ETH leg shared by `_settleNFTToPurchaser` and `relistNFT`: marks the listing
    ///      Settled, accrues the owner cut, and returns the backing (less that cut) to the depositor.
    ///      No NFT movement.
    function _payoutBackingToDepositor(Listing storage listing)
        internal
        returns (address depositor, address purchaser, uint256 toDepositor)
    {
        listing.status = ListingStatus.Settled;

        depositor = listing.depositor;
        purchaser = listing.purchaser;
        uint256 value = listing.value;

        // The purchaser takes no ETH on this outcome, so the owner's cut comes out of the
        // depositor's backing return. The immutable 5% cap keeps at least 95% for the depositor.
        uint256 ownerCut = value * ownerSettlementFeeBps / BPS;
        toDepositor = value - ownerCut;
        _accrueOwnerFee(ownerCut);

        SafeTransferLib.forceSafeTransferETH(depositor, toDepositor);
    }

    /// @dev ETH-settlement resolution shared by `acceptDepositorBid`, `depositorReclaimNFT`, and `acceptBidAsTokens`. Marks
    ///      the listing Settled, computes the purchaser's `settlementDiscountBps` payout, routes the retained settlement
    ///      penalty per `retainedToProtocol`, and returns the NFT to the depositor best-effort. It does
    ///      NOT deliver the `payout` — the caller delivers it as ETH or as FWAToken bought from the pool, so
    ///      the purchaser can accept the bid either way. Caller emits.
    function _settleBackingToPurchaser(uint256 listingId, Listing storage listing)
        internal
        returns (address depositor, address purchaser, uint256 payout, uint256 retained)
    {
        listing.status = ListingStatus.Settled;

        depositor = listing.depositor;
        purchaser = listing.purchaser;
        uint256 value = listing.value;

        payout = value * settlementDiscountBps / BPS; // purchaser's settlement, e.g. 85%
        retained = value - payout; // the settlement penalty, e.g. 15%

        // The retained penalty is the protocol's ONLY take on a settlement — no separate owner
        // resolution cut is charged here, so the purchaser receives the full settlementDiscount. By default
        // (`retainedToProtocol`) the penalty is protocol revenue; otherwise it is shared among
        // active depositors, falling back to the protocol when no active EV remains to receive it.
        if (retained != 0) {
            if (retainedToProtocol) _accrueOwnerFee(retained);
            else _distribute(retained);
        }

        _deliverNFT(listingId, listing.collection, depositor, listing.tokenId);
    }

    /// @dev Best-effort NFT delivery for a resolved listing. On any failure — a pausable, reverting,
    ///      or non-standard collection — the NFT is recorded as claimable by `to` via
    ///      `recoverStuckNFT`, so resolution's ETH legs always settle and the listing never locks.
    function _deliverNFT(uint256 listingId, address collection, address to, uint256 tokenId) internal {
        try ERC721(collection).transferFrom(address(this), to, tokenId) {
            // delivered
        } catch {
            stuckNFTRecipient[listingId] = to;
            emit NFTDeliveryFailed(listingId, to, collection, tokenId);
        }
    }

    /*//////////////////////////////////////////////////////////////
                          WITHDRAW EARNINGS
    //////////////////////////////////////////////////////////////*/

    /// @notice Withdraw your accrued share of acquisition earnings. No delay: these are
    ///         already-collected fees credited to you.
    function withdrawEarnings() external nonReentrant returns (uint256 amount) {
        amount = feeCredit[msg.sender];
        if (amount == 0) revert NoEarnings();

        feeCredit[msg.sender] = 0;
        SafeTransferLib.forceSafeTransferETH(msg.sender, amount);

        emit EarningsWithdrawn(msg.sender, amount);
    }

    /// @notice Claim the acquisition-fee share your still-active listings have collected so far, without
    ///         withdrawing them. The listings stay in the pool and keep earning — this just sweeps
    ///         their accrued fees to you and pays out in one call.
    /// @dev Harvest pattern: for each listing, credit its pending fees, then advance its dividend
    ///      checkpoint (`feeDebt`) to the current (floored) accumulator so the same fees can
    ///      never be claimed twice. Rounding down preserves `Σ credited ≤ Σ collected`, the same
    ///      solvency guarantee `_settleAndRemove` relies on. Touches neither `weight`/`value`
    ///      nor the pool totals, so a pending purchaser's pool is unaffected (no withdraw lock).
    /// @param listingIds Active listings to harvest. Every one must be yours and still active.
    /// @return total The ETH paid out across all the harvested listings.
    function claimListingFees(uint256[] calldata listingIds) external nonReentrant returns (uint256 total) {
        for (uint256 i = 0; i < listingIds.length; i++) {
            uint256 listingId = listingIds[i];
            Listing storage listing = _activeOwned(listingId);

            uint256 pending = _pendingFees(listing);
            if (pending == 0) continue;

            listing.feeDebt = listing.feeShare * accFeePerEV / SCALE;
            total += pending;

            emit EarningsAccrued(msg.sender, listingId, pending);
        }

        if (total == 0) revert NoEarnings();
        SafeTransferLib.forceSafeTransferETH(msg.sender, total);

        emit EarningsWithdrawn(msg.sender, total);
    }

    /// @notice Push accrued protocol fees out. A configurable `protocolFeeToTokenBps` slice is sent to
    ///         the FWAToken token's buyback reserve (where its TWAP `buyback` buys & burns/redistributes);
    ///         the remainder goes to the owner payout address. Permissionless. Returns the owner slice.
    function payoutFees() external nonReentrant returns (uint256 amount) {
        uint256 accrued = accruedOwnerFees;
        if (accrued == 0) revert NoOwnerFees();
        accruedOwnerFees = 0;

        uint256 tokenPortion = token == address(0) ? 0 : accrued * protocolFeeToTokenBps / BPS;
        amount = accrued - tokenPortion;

        address to = payoutAddress;
        if (amount != 0) SafeTransferLib.forceSafeTransferETH(to, amount);
        if (tokenPortion != 0) {
            SafeTransferLib.forceSafeTransferETH(token, tokenPortion); // FWAToken buyback reserve
            emit ProtocolFeesToToken(tokenPortion);
        }
        emit FeesPaidOut(to, amount);
    }

    /// @notice Unsettled acquisition-fee share an active listing has accrued but not yet credited.
    ///         Returns 0 for listings that are no longer active (their fees are already
    ///         settled into the depositor's `feeCredit`).
    function pendingFees(uint256 listingId) external view returns (uint256) {
        Listing storage listing = listings[listingId];
        if (listing.status != ListingStatus.Active) return 0;
        return _pendingFees(listing);
    }

    /*//////////////////////////////////////////////////////////////
                          FEE / EV ACCOUNTING
    //////////////////////////////////////////////////////////////*/

    /// @dev A listing's EV contribution (weight · value). Sums into `weightedBackingTotal`, which
    ///      drives only the acquisition price — NOT fee distribution (that uses `feeShare`, √value).
    ///      With inverse weights this is ≈ NUM for every listing.
    function _evOf(Listing storage listing) internal view returns (uint256) {
        return listing.weight * listing.value;
    }

    /// @dev Fees accrued to a listing since its last checkpoint, by its √value share. The current
    ///      (floored) value can sit just below the (ceiled) `feeDebt` when no fees have accrued,
    ///      so the subtraction saturates at zero instead of underflowing — and rounds the listing's
    ///      credit down, so the contract never over-credits.
    function _pendingFees(Listing storage listing) internal view returns (uint256) {
        uint256 acc = listing.feeShare * accFeePerEV / SCALE;
        uint256 debt = listing.feeDebt;
        return acc > debt ? acc - debt : 0;
    }

    /// @dev Accrue a protocol fee to the owner's withdrawable balance.
    function _accrueOwnerFee(uint256 amount) internal {
        if (amount == 0) return;
        accruedOwnerFees += amount;
        emit OwnerFeesAccrued(amount);
    }

    /// @dev Distribute `amount` wei to active depositors equally per listing (flat fee share). If no
    ///      active share remains to receive it, the amount accrues to protocol fees so it is
    ///      never stranded.
    function _distribute(uint256 amount) internal {
        if (feeShareTotal > 0) {
            accFeePerEV += amount * SCALE / feeShareTotal;
        } else {
            _accrueOwnerFee(amount);
        }
    }

    /// @dev Settle the current top's accrued pot into its holder's `feeCredit` and vacate the
    ///      top. Idempotent (no-op when vacant) and resets `topListingPot` to 0 in the same write
    ///      as clearing `topListingId`, so the pot — additive ETH that was already collected via the
    ///      acquisition topListingShare — can be settled at most once per tenure and is never double-paid or stranded.
    ///      Effect-only (credits `feeCredit`, no ETH transfer), so it is reentrancy-safe to call
    ///      before interactions, mirroring `_settleAndRemove`.
    function _vacateTop() internal {
        uint256 id = topListingId;
        if (id == 0) return;

        uint256 pot = topListingPot;
        topListingId = 0;
        topListingPot = 0;

        if (pot != 0) {
            address depositor = listings[id].depositor;
            feeCredit[depositor] += pot;
            emit TopListingSettled(id, depositor, pot);
        }

        emit TopListingSet(0, address(0));
    }

    /// @dev Top an active listing. The caller must have vacated any prior top first, so the pot
    ///      starts fresh at 0 for the new holder.
    function _setTop(uint256 listingId) internal {
        topListingId = listingId;
        emit TopListingSet(listingId, listings[listingId].depositor);
    }

    /// @dev True when `value` clears the standing top (`currentId`, must be non-zero) by
    ///      `topThresholdBps`. Cross-multiplied so no intermediate division rounds the bar down in
    ///      the challenger's favor; safe from overflow since value <= 1e36 (weight != 0) and the bps
    ///      factor <= 2e4, so the products stay far inside uint256.
    function _beatsTop(uint256 value, uint256 currentId) internal view returns (bool) {
        return value * BPS >= listings[currentId].value * (BPS + topThresholdBps);
    }

    /// @dev Settle a listing's accrued fees into its depositor's credit, then remove it from
    ///      the active pool (weight, EV, fee share, slot, mapping). Settlement MUST precede the
    ///      share removal so the pending amount is computed against the listing's live share.
    function _settleAndRemove(uint256 listingId) internal {
        Listing storage listing = listings[listingId];

        uint256 pending = _pendingFees(listing);
        if (pending != 0) {
            feeCredit[listing.depositor] += pending;
            emit EarningsAccrued(listing.depositor, listingId, pending);
        }

        IFWARewards r = rewards;
        if (address(r) != address(0)) r.onListingRemoved(listingId);

        uint256 slot = listing.slot;

        _removeTreeWeight(slot, listing.weight);
        totalWeight -= listing.weight;
        weightedBackingTotal -= _evOf(listing);
        activeBackingTotal -= listing.value;
        feeShareTotal -= listing.feeShare;
        activeListingCount--;

        delete slotToListing[slot];
        _releaseSlot(slot);

        listing.slot = 0;
    }

    /*//////////////////////////////////////////////////////////////
                      SEGMENT TREE: ADD WEIGHT
    //////////////////////////////////////////////////////////////*/

    function _addTreeWeight(uint256 slot, uint256 amount) internal {
        uint256 node = LEAF_BASE + slot - 1;

        /*
            Update leaf, then every ancestor through the root.
        */
        while (true) {
            tree[node] += amount;

            if (node == 1) break;

            node >>= 1;
        }
    }

    /*//////////////////////////////////////////////////////////////
                     SEGMENT TREE: REMOVE WEIGHT
    //////////////////////////////////////////////////////////////*/

    function _removeTreeWeight(uint256 slot, uint256 amount) internal {
        uint256 node = LEAF_BASE + slot - 1;

        while (true) {
            tree[node] -= amount;

            if (node == 1) break;

            node >>= 1;
        }
    }

    /*//////////////////////////////////////////////////////////////
                    SEGMENT TREE: SELECT LISTING
    //////////////////////////////////////////////////////////////*/

    function _selectSlot(uint256 target) internal view returns (uint256 slot) {
        /*
            target must be in:

                0 <= target < tree[1]

            At each branch:

            - If target is inside the left subtree, descend left.
            - Otherwise subtract the left subtree's range and descend right.
        */
        uint256 node = 1;

        while (node < LEAF_BASE) {
            uint256 leftChild = node << 1;
            uint256 leftWeight = tree[leftChild];

            if (target < leftWeight) {
                node = leftChild;
            } else {
                target -= leftWeight;
                node = leftChild | 1;
            }
        }

        slot = node - LEAF_BASE + 1;
    }

    /*//////////////////////////////////////////////////////////////
                           SLOT ALLOCATION
    //////////////////////////////////////////////////////////////*/

    function _allocateSlot() internal returns (uint256 slot) {
        /*
            Reuse a previously released slot when possible.
        */
        if (freeSlotHead != 0) {
            slot = freeSlotHead;
            freeSlotHead = nextFreeSlot[slot];

            delete nextFreeSlot[slot];

            return slot;
        }

        /*
            Otherwise expand into the next unused logical slot.

            No array is expanded and no storage is preallocated.
        */
        slot = nextUnusedSlot++;

        if (slot > CAPACITY) revert ActiveListingCapacityReached();
    }

    function _releaseSlot(uint256 slot) internal {
        nextFreeSlot[slot] = freeSlotHead;
        freeSlotHead = slot;
    }

    /*//////////////////////////////////////////////////////////////
                              OWNER CONFIG
    //////////////////////////////////////////////////////////////*/

    /// @dev Revert unless `v` is a valid bps fraction (<= BPS).
    function _bpsCapped(uint256 v) internal pure returns (uint256) {
        if (v > BPS) revert InvalidConfig();
        return v;
    }

    /// @notice Set a uint-valued config knob, keyed by a `FWAConfigKeys` constant. Consolidates the
    ///         former per-knob setters into one dispatcher to keep the runtime bytecode under the
    ///         EIP-170 limit; each branch preserves its old setter's validation exactly (bounds,
    ///         window cross-invariants, narrow-type ranges). The VRF key hash is passed as
    ///         `uint256(keyHash)`. Unknown keys revert `InvalidConfig`.
    function setUint(uint256 key, uint256 value) external onlyOwner {
        if (unsettledAcquisitionCount != 0) revert AcquisitionStateLocked();
        if (key == FWAConfigKeys.VRF_SUB_ID) {
            if (value == 0) revert InvalidConfig();
            if (unfulfilledVrfCount != 0) revert AcquisitionStateLocked();
            vrfSubId = value;
        } else if (key == FWAConfigKeys.REQUEST_CONFIRMATIONS) {
            if (value < MIN_REQUEST_CONFIRMATIONS || value > MAX_REQUEST_CONFIRMATIONS) revert InvalidConfig();
            if (selectionTimeoutBlocks < value + MIN_CALLBACK_SLACK_BLOCKS) revert InvalidConfig();
            requestConfirmations = uint16(value);
        } else if (key == FWAConfigKeys.MAX_ACTIVATIONS_PER_ACQUISITION) {
            if (value == 0 || value > MAX_ACTIVATIONS_PER_ACQUISITION) revert InvalidConfig();
            maxActivationsPerAcquisition = value;
        } else if (key == FWAConfigKeys.SELECTION_TIMEOUT_BLOCKS) {
            if (value < uint256(requestConfirmations) + MIN_CALLBACK_SLACK_BLOCKS || value > MAX_WINDOW_BLOCKS) {
                revert InvalidConfig();
            }
            selectionTimeoutBlocks = value;
        } else if (key == FWAConfigKeys.MAX_ACQUISITIONS_PER_TX) {
            if (value == 0) revert InvalidConfig();
            maxAcquisitionsPerTx = value;
        } else if (key == FWAConfigKeys.SURCHARGE_BPS) {
            surchargeBps = value; // deliberately uncapped: an EV surcharge above 100% is meaningful
        } else if (key == FWAConfigKeys.SELECTION_SLIPPAGE_BPS) {
            selectionSlippageBps = _bpsCapped(value);
        } else if (key == FWAConfigKeys.TOP_LISTING_SHARE_BPS) {
            topListingShareBps = _bpsCapped(value);
        } else if (key == FWAConfigKeys.TOP_THRESHOLD_BPS) {
            topThresholdBps = _bpsCapped(value);
        } else if (key == FWAConfigKeys.SETTLEMENT_DISCOUNT_BPS) {
            if (value < MIN_SETTLEMENT_DISCOUNT_BPS || value > MAX_SETTLEMENT_DISCOUNT_BPS) {
                revert InvalidConfig();
            }
            // Keep the purchaser's payout non-negative: the owner's cut can't exceed the discount.
            if (value < ownerSettlementFeeBps) revert InvalidConfig();
            settlementDiscountBps = value;
        } else if (key == FWAConfigKeys.OWNER_ACQUISITION_FEE_BPS) {
            ownerAcquisitionFeeBps = _bpsCapped(value);
        } else if (key == FWAConfigKeys.OWNER_SETTLEMENT_FEE_BPS) {
            if (value > MAX_OWNER_SETTLEMENT_FEE_BPS || value > settlementDiscountBps) revert InvalidConfig();
            ownerSettlementFeeBps = value;
        } else if (key == FWAConfigKeys.SETTLEMENT_WINDOW) {
            if (value < MIN_SETTLEMENT_WINDOW || value > MAX_SETTLEMENT_WINDOW || value > finalizeWindow) {
                revert InvalidConfig();
            }
            settlementWindow = value;
        } else if (key == FWAConfigKeys.FINALIZE_WINDOW) {
            if (value < MIN_FINALIZE_WINDOW || value > MAX_FINALIZE_WINDOW || value < settlementWindow) {
                revert InvalidConfig();
            }
            finalizeWindow = value;
        } else if (key == FWAConfigKeys.MIN_BACKING) {
            minBacking = value;
        } else if (key == FWAConfigKeys.PROTOCOL_FEE_TO_TOKEN_BPS) {
            protocolFeeToTokenBps = _bpsCapped(value);
        } else if (key == FWAConfigKeys.MAX_STAGED_LISTINGS) {
            maxStagedListings = value; // 0 = unlimited
        } else {
            revert InvalidConfig();
        }
        emit ConfigSet(key, value);
    }

    /// @notice Set a bool-valued config knob. Opening acquisitions also starts the optional rewards
    ///         module's emission clock (idempotently).
    function setBool(uint256 key, bool value) external onlyOwner {
        if (key == FWAConfigKeys.RETAINED_TO_PROTOCOL) {
            retainedToProtocol = value;
        } else if (key == FWAConfigKeys.ACQUISITIONS_ENABLED) {
            if (value && rewardsRequiredForActivation) {
                if (address(rewards) == address(0)) revert InvalidConfig();
                (bool ok, bytes memory data) = address(s_vrfCoordinator).staticcall(
                    abi.encodeWithSignature("launchReady()")
                );
                if (!ok || data.length != 32 || !abi.decode(data, (bool))) revert InvalidConfig();
                (ok, data) = payoutAddress.staticcall(abi.encodeWithSignature("revenueReady()"));
                if (!ok || data.length != 32 || !abi.decode(data, (bool))) revert InvalidConfig();
            }
            acquisitionsEnabled = value;
            IFWARewards r = rewards;
            if (value && address(r) != address(0)) r.startEmission();
        } else if (key == FWAConfigKeys.WITHDRAW_ONLY) {
            withdrawOnly = value;
        } else if (key == FWAConfigKeys.WHITELIST_ENABLED) {
            whitelistEnabled = value;
        } else if (key == FWAConfigKeys.ACCEPT_BID_AS_TOKENS_ENABLED) {
            acceptBidAsTokensEnabled = value;
        } else if (key == FWAConfigKeys.REWARDS_REQUIRED_FOR_ACTIVATION) {
            // This launch property is intentionally one-way: no later admin action can bypass it.
            if (!value || acquisitionsEnabled) revert InvalidConfig();
            rewardsRequiredForActivation = true;
        } else {
            revert InvalidConfig();
        }
        emit ConfigSet(key, value ? 1 : 0);
    }

    /// @notice Set an address-valued config knob, keyed by a `FWAConfigKeys` constant. Zero address
    ///         rejected for every key except `WHITELIST_MANAGER` (zero revokes the manager). A new
    ///         VRF coordinator's subscription must already list this contract as a consumer. Unknown
    ///         keys revert `InvalidConfig`.
    function setAddr(uint256 key, address value) external onlyOwner {
        if (key == FWAConfigKeys.WHITELIST_MANAGER) {
            whitelistManager = value; // zero allowed: revokes the manager (msg.sender is never zero)
        } else if (value == address(0)) {
            revert InvalidConfig();
        } else if (key == FWAConfigKeys.VRF_COORDINATOR) {
            if (unsettledAcquisitionCount != 0 || unfulfilledVrfCount != 0) revert AcquisitionStateLocked();
            s_vrfCoordinator = IVRFCoordinatorV2Plus(value);
        } else if (key == FWAConfigKeys.PAYOUT_ADDRESS) {
            payoutAddress = value;
        } else {
            revert InvalidConfig();
        }
        emit ConfigSet(key, uint256(uint160(value)));
    }

    /// @notice Add (`allowed = true`) or remove (`false`) collections from the deposit whitelist.
    ///         All entries get the same `allowed` value. Only gates NEW deposits while
    ///         `whitelistEnabled` is true; listings already in the pool are unaffected. Callable by
    ///         the owner or the owner-appointed `whitelistManager` (a curation contract, say).
    function setCollectionsWhitelisted(address[] calldata collections, bool allowed) external {
        if (msg.sender != owner() && msg.sender != whitelistManager) revert Unauthorized();
        for (uint256 i = 0; i < collections.length; i++) {
            collectionWhitelisted[collections[i]] = allowed;
            emit CollectionWhitelistSet(collections[i], allowed);
        }
    }

    /// @notice One-time wire of the separately deployed FWAToken rewards/swap module.
    function setRewards(address module) external onlyOwner {
        if (module == address(0) || address(rewards) != address(0)) revert InvalidConfig();
        if (unsettledAcquisitionCount != 0) revert AcquisitionStateLocked();
        if (activeListingCount != 0 || stagedCount != 0 || reservedStagedCount != 0) revert InvalidConfig();
        IFWARewards r = IFWARewards(module);
        address rewardToken = r.token();
        if (rewardToken == address(0) || r.fwa() != address(this)) revert InvalidConfig();
        rewards = r;
        token = rewardToken;
        if (acquisitionsEnabled) r.startEmission();
        emit RewardsConfigured(module, rewardToken);
    }

    /// @notice Migration guard consumed by the rewards module before an owner token rescue.
    function canRescueRewards() external view returns (bool) {
        return withdrawOnly && unsettledAcquisitionCount == 0;
    }

    /*//////////////////////////////////////////////////////////////
                              TREE VIEWS
    //////////////////////////////////////////////////////////////*/

    function treeRootWeight() external view returns (uint256) {
        return tree[1];
    }
}
