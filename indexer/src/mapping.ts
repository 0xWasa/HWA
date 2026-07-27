import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  AcquisitionExpired,
  AcquisitionProcessed,
  AcquisitionRefundedNoListing,
  AcquisitionRefundedSlippage,
  AcquisitionRefundWithdrawn,
  AcquisitionRequested,
  AcquisitionSequenced,
  BackingUpdated,
  DepositorBidAccepted,
  DepositorBidAcceptedAsTokens,
  DepositorTimeoutResolved,
  EarningsWithdrawn,
  EarningsAccrued,
  ConfigSet,
  CollectionWhitelistSet,
  FeesPaidOut,
  ListingStaged,
  ListingWithdrawn,
  NFTAllocated,
  NFTDeliveryFailed,
  NFTKept,
  NFTListed,
  NFTRelisted,
  RandomnessCached,
  RandomnessTimedOut,
  StuckNFTRecovered,
  TopListingSet,
  TopListingFunded,
  TopListingSettled,
  ProtocolFeesToToken,
  UnsettledFinalized,
  VrfServiceFeePaid,
} from "../generated/FWA/FWA";
import { ERC721 } from "../generated/FWA/ERC721";
import { Acquisition, AcquisitionTransaction, Activity, Listing, ProtocolState } from "../generated/schema";

const ZERO = BigInt.zero();

function listingKey(id: BigInt): string {
  return id.toString();
}

function acquisitionKey(id: BigInt): string {
  return id.toString();
}

function transactionKey(event: ethereum.Event): string {
  return event.transaction.hash.toHexString();
}

function eventKey(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

function loadState(event: ethereum.Event): ProtocolState {
  const existing = ProtocolState.load("protocol");
  if (existing != null) return existing;
  const state = new ProtocolState("protocol");
  state.totalListings = 0;
  state.activeListingCount = 0;
  state.stagedListingCount = 0;
  state.totalBacking = ZERO;
  state.totalWeight = ZERO;
  state.lastEventBlock = event.block.number;
  state.lastEventTimestamp = event.block.timestamp;
  state.save();
  return state;
}

function touch(event: ethereum.Event): void {
  const state = loadState(event);
  state.lastEventBlock = event.block.number;
  state.lastEventTimestamp = event.block.timestamp;
  state.save();
}

function newActivity(event: ethereum.Event, kind: string): Activity {
  const activity = new Activity(eventKey(event));
  activity.type = kind;
  activity.txHash = event.transaction.hash;
  activity.logIndex = event.logIndex;
  activity.blockNumber = event.block.number;
  activity.timestamp = event.block.timestamp;
  touch(event);
  return activity;
}

function updateListingEvent(listing: Listing, event: ethereum.Event): void {
  listing.updatedAt = event.block.timestamp;
  listing.updatedBlock = event.block.number;
  listing.updatedTx = event.transaction.hash;
}

function attachListing(activity: Activity, listingId: BigInt): void {
  const listing = Listing.load(listingKey(listingId));
  if (listing == null) return;
  activity.collection = listing.collection;
  activity.tokenId = listing.tokenId;
}

function captureTokenURI(listing: Listing): void {
  const token = ERC721.bind(Address.fromBytes(listing.collection));
  const result = token.try_tokenURI(listing.tokenId);
  if (!result.reverted) listing.tokenURI = result.value;
}

function acquisitionStatus(code: i32): string {
  if (code == 1) return "pending";
  if (code == 2) return "fulfilled";
  if (code == 3) return "expired";
  if (code == 4) return "refunded";
  if (code == 5) return "ready";
  if (code == 6) return "timed_out";
  return "none";
}

function loadAcquisition(id: BigInt): Acquisition | null {
  return Acquisition.load(acquisitionKey(id));
}

export function handleListingStaged(event: ListingStaged): void {
  let listing = Listing.load(listingKey(event.params.listingId));
  if (listing == null) {
    listing = new Listing(listingKey(event.params.listingId));
    listing.listingId = event.params.listingId;
    listing.collection = event.params.collection;
    listing.tokenId = event.params.tokenId;
    listing.depositor = event.params.depositor;
    listing.listedAt = event.block.timestamp;
    const state = loadState(event);
    listing.isCrown = state.currentTopListing == listingKey(event.params.listingId);
    state.totalListings += 1;
    state.stagedListingCount += 1;
    state.save();
  }
  listing.status = "staged";
  listing.backing = event.params.value;
  listing.weight = ZERO;
  captureTokenURI(listing);
  updateListingEvent(listing, event);
  listing.save();

  const activity = newActivity(event, "deposit");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  activity.collection = event.params.collection;
  activity.tokenId = event.params.tokenId;
  activity.amount = event.params.value;
  activity.save();
}

export function handleNFTListed(event: NFTListed): void {
  let listing = Listing.load(listingKey(event.params.listingId));
  const isNew = listing == null;
  const wasStaged = listing != null && listing.status == "staged";
  if (listing == null) {
    listing = new Listing(listingKey(event.params.listingId));
    listing.listingId = event.params.listingId;
    listing.listedAt = event.block.timestamp;
    listing.isCrown = false;
  }
  listing.status = "active";
  listing.collection = event.params.collection;
  listing.tokenId = event.params.tokenId;
  listing.depositor = event.params.depositor;
  listing.backing = event.params.value;
  listing.weight = event.params.weight;
  const state = loadState(event);
  listing.isCrown = state.currentTopListing == listingKey(event.params.listingId);
  captureTokenURI(listing);
  updateListingEvent(listing, event);
  listing.save();

  if (isNew) state.totalListings += 1;
  if (wasStaged) state.stagedListingCount -= 1;
  state.activeListingCount += 1;
  state.totalBacking = state.totalBacking.plus(event.params.value);
  state.totalWeight = state.totalWeight.plus(event.params.weight);
  state.save();

  const activity = newActivity(event, isNew ? "deposit" : "activation");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  activity.collection = event.params.collection;
  activity.tokenId = event.params.tokenId;
  activity.amount = event.params.value;
  activity.save();
}

export function handleListingWithdrawn(event: ListingWithdrawn): void {
  const listing = Listing.load(listingKey(event.params.listingId));
  if (listing != null) {
    const state = loadState(event);
    if (listing.status == "active") {
      state.activeListingCount -= 1;
      state.totalBacking = state.totalBacking.minus(listing.backing);
      state.totalWeight = state.totalWeight.minus(listing.weight);
    } else if (listing.status == "staged") {
      state.stagedListingCount -= 1;
    }
    state.save();
    listing.status = "withdrawn";
    listing.isCrown = false;
    updateListingEvent(listing, event);
    listing.save();
  }
  const activity = newActivity(event, "withdraw_listing");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.value;
  activity.save();
}

export function handleBackingUpdated(event: BackingUpdated): void {
  const listing = Listing.load(listingKey(event.params.listingId));
  if (listing != null) {
    const state = loadState(event);
    state.totalBacking = state.totalBacking.minus(listing.backing).plus(event.params.newBacking);
    state.totalWeight = state.totalWeight.minus(listing.weight).plus(event.params.newWeight);
    state.save();
    listing.backing = event.params.newBacking;
    listing.weight = event.params.newWeight;
    updateListingEvent(listing, event);
    listing.save();
  }
  const activity = newActivity(event, "backing_update");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.newBacking;
  activity.save();
}

export function handleVrfServiceFeePaid(event: VrfServiceFeePaid): void {
  const key = transactionKey(event);
  let context = AcquisitionTransaction.load(key);
  if (context == null) {
    context = new AcquisitionTransaction(key);
    context.txHash = event.transaction.hash;
    context.purchaser = event.params.purchaser;
    context.serviceFeeTotal = ZERO;
    context.requestCount = 0;
  }
  context.serviceFeeTotal = context.serviceFeeTotal.plus(event.params.amount);
  context.save();
  touch(event);
}

export function handleAcquisitionRequested(event: AcquisitionRequested): void {
  const txKey = transactionKey(event);
  let context = AcquisitionTransaction.load(txKey);
  if (context == null) {
    context = new AcquisitionTransaction(txKey);
    context.txHash = event.transaction.hash;
    context.purchaser = event.params.purchaser;
    context.serviceFeeTotal = ZERO;
    context.requestCount = 0;
  }
  context.requestCount += 1;
  context.save();

  const acquisition = new Acquisition(acquisitionKey(event.params.requestId));
  acquisition.requestId = event.params.requestId;
  acquisition.purchaser = event.params.purchaser;
  acquisition.acquisitionFee = event.params.acquisitionFee;
  acquisition.totalWeight = event.params.totalWeight;
  acquisition.status = "pending";
  acquisition.requestedAt = event.block.timestamp;
  acquisition.requestedBlock = event.block.number;
  acquisition.txHash = event.transaction.hash;
  acquisition.context = txKey;
  acquisition.save();

  const activity = newActivity(event, "acquisition_request");
  activity.address = event.params.purchaser;
  activity.amount = event.params.acquisitionFee;
  activity.save();
}

export function handleAcquisitionSequenced(event: AcquisitionSequenced): void {
  const acquisition = loadAcquisition(event.params.requestId);
  if (acquisition != null) {
    acquisition.sequence = event.params.sequence;
    acquisition.wordDeadlineBlock = event.params.wordDeadlineBlock;
    acquisition.save();
  }
  touch(event);
}

export function handleRandomnessCached(event: RandomnessCached): void {
  const acquisition = loadAcquisition(event.params.requestId);
  if (acquisition != null) {
    acquisition.status = "ready";
    acquisition.save();
  }
  const activity = newActivity(event, "randomness_cached");
  activity.listingId = event.params.requestId;
  activity.save();
}

export function handleRandomnessTimedOut(event: RandomnessTimedOut): void {
  const acquisition = loadAcquisition(event.params.requestId);
  if (acquisition != null) {
    acquisition.status = "timed_out";
    acquisition.save();
  }
  touch(event);
}

export function handleAcquisitionProcessed(event: AcquisitionProcessed): void {
  const acquisition = loadAcquisition(event.params.requestId);
  if (acquisition != null) {
    acquisition.status = acquisitionStatus(event.params.status);
    acquisition.save();
  }
  touch(event);
}

function markRefund(requestId: BigInt, amount: BigInt): void {
  const acquisition = loadAcquisition(requestId);
  if (acquisition != null) {
    acquisition.status = "refunded";
    acquisition.refund = amount;
    acquisition.save();
  }
}

export function handleAcquisitionExpired(event: AcquisitionExpired): void {
  markRefund(event.params.requestId, event.params.refund);
  const activity = newActivity(event, "acquisition_refund");
  activity.address = event.params.purchaser;
  activity.amount = event.params.refund;
  activity.save();
}

export function handleAcquisitionRefundedNoListing(event: AcquisitionRefundedNoListing): void {
  markRefund(event.params.requestId, event.params.refund);
  const activity = newActivity(event, "acquisition_refund");
  activity.address = event.params.purchaser;
  activity.amount = event.params.refund;
  activity.save();
}

export function handleAcquisitionRefundedSlippage(event: AcquisitionRefundedSlippage): void {
  markRefund(event.params.requestId, event.params.refund);
  const activity = newActivity(event, "acquisition_refund");
  activity.address = event.params.purchaser;
  activity.amount = event.params.refund;
  activity.save();
}

export function handleAcquisitionRefundWithdrawn(event: AcquisitionRefundWithdrawn): void {
  const activity = newActivity(event, "acquisition_refund");
  activity.address = event.params.purchaser;
  activity.amount = event.params.amount;
  activity.save();
}

export function handleNFTAllocated(event: NFTAllocated): void {
  const listing = Listing.load(listingKey(event.params.listingId));
  if (listing != null) {
    const state = loadState(event);
    state.activeListingCount -= 1;
    state.totalBacking = state.totalBacking.minus(listing.backing);
    state.totalWeight = state.totalWeight.minus(listing.weight);
    state.save();
    listing.status = "allocated";
    listing.purchaser = event.params.purchaser;
    listing.allocatedAt = event.block.timestamp;
    listing.isCrown = false;
    updateListingEvent(listing, event);
    listing.save();
  }
  const acquisition = loadAcquisition(event.params.requestId);
  if (acquisition != null) {
    acquisition.status = "fulfilled";
    acquisition.listingId = event.params.listingId;
    acquisition.save();
    if (listing != null) {
      const context = AcquisitionTransaction.load(acquisition.context);
      let serviceFee = ZERO;
      if (context != null && context.requestCount > 0) {
        serviceFee = context.serviceFeeTotal.div(BigInt.fromI32(context.requestCount));
      }
      listing.acquiredFor = acquisition.acquisitionFee.plus(serviceFee);
      listing.save();
    }
  }
  const activity = newActivity(event, "allocation");
  activity.address = event.params.purchaser;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.value;
  activity.save();
}

function settleListing(listingId: BigInt, outcome: string, event: ethereum.Event): void {
  const listing = Listing.load(listingKey(listingId));
  if (listing != null) {
    listing.status = "settled";
    listing.settlement = outcome;
    listing.isCrown = false;
    updateListingEvent(listing, event);
    listing.save();
  }
}

export function handleNFTKept(event: NFTKept): void {
  settleListing(event.params.listingId, "kept", event);
  const activity = newActivity(event, "keep");
  activity.address = event.params.purchaser;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.backing;
  activity.save();
}

export function handleNFTRelisted(event: NFTRelisted): void {
  settleListing(event.params.listingId, "relisted", event);
  const activity = newActivity(event, "relist");
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.toDepositor;
  activity.save();
}

export function handleDepositorBidAccepted(event: DepositorBidAccepted): void {
  settleListing(event.params.listingId, "bid_accepted", event);
  const activity = newActivity(event, "bid_accepted");
  activity.address = event.params.purchaser;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.payout;
  activity.save();
}

export function handleDepositorBidAcceptedAsTokens(event: DepositorBidAcceptedAsTokens): void {
  settleListing(event.params.listingId, "bid_accepted_tokens", event);
  const activity = newActivity(event, "bid_accepted_tokens");
  activity.address = event.params.purchaser;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.ethPayout;
  activity.tokenAmount = event.params.tokenOut;
  activity.save();
}

export function handleUnsettledFinalized(event: UnsettledFinalized): void {
  settleListing(event.params.listingId, "finalized", event);
  const activity = newActivity(event, "finalized");
  activity.address = event.params.purchaser;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.save();
}

export function handleNFTDeliveryFailed(event: NFTDeliveryFailed): void {
  const activity = newActivity(event, "delivery_failed");
  activity.address = event.params.recipient;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.collection = event.params.collection;
  activity.tokenId = event.params.tokenId;
  activity.save();
}

export function handleStuckNFTRecovered(event: StuckNFTRecovered): void {
  const activity = newActivity(event, "stuck_recovered");
  activity.address = event.params.recipient;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.save();
}

export function handleEarningsWithdrawn(event: EarningsWithdrawn): void {
  const activity = newActivity(event, "earnings_withdraw");
  activity.address = event.params.depositor;
  activity.amount = event.params.amount;
  activity.save();
}

export function handleTopListingSet(event: TopListingSet): void {
  const state = loadState(event);
  if (state.currentTopListing != null) {
    const oldListing = Listing.load(state.currentTopListing!);
    if (oldListing != null) {
      oldListing.isCrown = false;
      oldListing.save();
    }
  }
  state.currentTopListing = event.params.listingId.equals(ZERO) ? null : listingKey(event.params.listingId);
  state.lastEventBlock = event.block.number;
  state.lastEventTimestamp = event.block.timestamp;
  state.save();

  if (!event.params.listingId.equals(ZERO)) {
    const listing = Listing.load(listingKey(event.params.listingId));
    if (listing != null) {
      listing.isCrown = true;
      listing.save();
    }
    const activity = newActivity(event, "crown_set");
    activity.address = event.params.depositor;
    activity.listingId = event.params.listingId;
    attachListing(activity, event.params.listingId);
    activity.save();
  }
}

export function handleTopListingSettled(event: TopListingSettled): void {
  const activity = newActivity(event, "crown_settled");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.amount;
  activity.save();
}

export function handleDepositorTimeoutResolved(event: DepositorTimeoutResolved): void {
  const activity = newActivity(event, "depositor_resolved");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.nftReclaimed ? BigInt.fromI32(1) : ZERO;
  activity.save();
}

export function handleEarningsAccrued(event: EarningsAccrued): void {
  const activity = newActivity(event, "earnings_accrued");
  activity.address = event.params.depositor;
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.amount;
  activity.save();
}

export function handleConfigSet(event: ConfigSet): void {
  const activity = newActivity(event, "config_set");
  activity.listingId = event.params.key;
  activity.amount = event.params.value;
  activity.save();
}

export function handleCollectionWhitelistSet(event: CollectionWhitelistSet): void {
  const activity = newActivity(event, "collection_whitelist");
  activity.collection = event.params.collection;
  activity.amount = event.params.allowed ? BigInt.fromI32(1) : ZERO;
  activity.save();
}

export function handleFeesPaidOut(event: FeesPaidOut): void {
  const activity = newActivity(event, "fees_paid_out");
  activity.address = event.params.to;
  activity.amount = event.params.amount;
  activity.save();
}

export function handleTopListingFunded(event: TopListingFunded): void {
  const activity = newActivity(event, "crown_funded");
  activity.listingId = event.params.listingId;
  attachListing(activity, event.params.listingId);
  activity.amount = event.params.amount;
  activity.save();
}

export function handleProtocolFeesToToken(event: ProtocolFeesToToken): void {
  const activity = newActivity(event, "protocol_fees_to_token");
  activity.amount = event.params.amount;
  activity.save();
}
