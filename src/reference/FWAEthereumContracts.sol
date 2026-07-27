// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Build-only index of the untouched verified Ethereum sources. The source files
// themselves remain under FWA_ETHEREUM_REFERENCE and are never patched for the port.
import {FWA} from "fwa-reference/src/FWA.sol";
import {FWARewards} from "fwa-rewards-reference/src/FWARewards.sol";
import {FWAVRFService} from "fwa-vrf-reference/src/FWAVRFService.sol";
import {FWAToken} from "fwa-rewards-reference/src/FWAToken.sol";
import {FWATokenHook} from "fwa-hook-reference/src/FWATokenHook.sol";
import {FWAClaim} from "fwa-claim-reference/src/FWAClaim.sol";
import {FWAWhitelist} from "fwa-whitelist-reference/src/FWAWhitelist.sol";
import {Splitter} from "fwa-splitter-reference/src/Splitter.sol";

