// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "solady/src/auth/Ownable.sol";

interface IWhitelistedPool {
    function setCollectionsWhitelisted(address[] calldata collections, bool allowed) external;
}

interface IERC721Burnable {
    function transferFrom(address from, address to, uint256 id) external;
}

/// @title FWAWhitelist
/// @notice Manager for FWA's deposit-collection whitelist. Registered on FWA as the
///         `WHITELIST_MANAGER` (`setAddr`), so it may call `setCollectionsWhitelisted` without
///         owning FWA. Two paths in:
///           - the OWNER adds/removes collections at will (`setCollections`), and can BLOCK a
///             malicious collection — blocking de-whitelists it and bars the burn path from ever
///             re-adding it until unblocked;
///           - ANYONE may whitelist a collection by burning `TTT_AMOUNT` Ten Thousand Tokens NFTs
///             to the dead address (`burnToWhitelist`).
/// @dev    FWA is the redeployable leg of the system (see docs/MIGRATION.md), so the `fwa` pointer
///         is owner-settable; `ttt` is fixed at construction (zero disables the burn path).
contract FWAWhitelist is Ownable {
    /*//////////////////////////////////////////////////////////////
                                 STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Burned NFTs land here — no code, no owner, provably unspendable.
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice Ten Thousand Tokens. Zero disables the public burn path entirely.
    address public immutable ttt;

    /// @notice The FWA contract this manager administers. Owner-settable so a replacement FWA
    ///         (migration) keeps the same whitelist manager.
    address public fwa;

    /// @notice How many TTT NFTs a caller must burn to whitelist one collection. Owner-settable;
    ///         `0` disables the burn path.
    uint256 public TTT_AMOUNT;

    /// @notice Collections barred from the burn path. Blocking also de-whitelists on FWA, so an
    ///         owner removal of a malicious collection cannot be undone by simply burning more TTT.
    mapping(address => bool) public blocked;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event FWASet(address fwa);
    event TTTAmountSet(uint256 amount);
    event CollectionBlockedSet(address indexed collection, bool isBlocked);
    event CollectionsSet(address[] collections, bool allowed);
    event BurnedForWhitelist(address indexed burner, address indexed collection, uint256[] tokenIds);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error BurnPathDisabled();
    error CollectionBlocked();
    error WrongBurnCount();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address _fwa, address _ttt, uint256 _tttAmount, address _owner) {
        if (_fwa == address(0)) revert ZeroAddress();
        _initializeOwner(_owner);
        fwa = _fwa;
        ttt = _ttt;
        TTT_AMOUNT = _tttAmount;
        emit FWASet(_fwa);
        emit TTTAmountSet(_tttAmount);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Repoint at a replacement FWA (the new FWA's owner must also register this contract
    ///         as its WHITELIST_MANAGER).
    function setFWA(address _fwa) external onlyOwner {
        if (_fwa == address(0)) revert ZeroAddress();
        fwa = _fwa;
        emit FWASet(_fwa);
    }

    /// @notice Set the burn price. `0` disables the public burn path.
    function setTTTAmount(uint256 amount) external onlyOwner {
        TTT_AMOUNT = amount;
        emit TTTAmountSet(amount);
    }

    /// @notice Owner add/remove passthrough — mirrors `FWA.setCollectionsWhitelisted`.
    function setCollections(address[] calldata collections, bool allowed) external onlyOwner {
        IWhitelistedPool(fwa).setCollectionsWhitelisted(collections, allowed);
        emit CollectionsSet(collections, allowed);
    }

    /// @notice Block (or unblock) a collection from the burn path. Blocking also de-whitelists it
    ///         on FWA, so removal of a malicious collection sticks: re-adding it needs the OWNER to
    ///         unblock, not just another burn. Unblocking does NOT re-whitelist.
    function setBlocked(address collection, bool isBlocked) external onlyOwner {
        blocked[collection] = isBlocked;
        if (isBlocked) _setWhitelisted(collection, false);
        emit CollectionBlockedSet(collection, isBlocked);
    }

    /*//////////////////////////////////////////////////////////////
                             PUBLIC BURN PATH
    //////////////////////////////////////////////////////////////*/

    /// @notice Whitelist `collection` on FWA by burning exactly `TTT_AMOUNT` Ten Thousand Tokens
    ///         NFTs (sent to the dead address). Caller must own (or be approved for) each token.
    ///         Duplicate ids fail on the second transfer — the same NFT can't be counted twice.
    function burnToWhitelist(address collection, uint256[] calldata tokenIds) external {
        uint256 amount = TTT_AMOUNT;
        if (ttt == address(0) || amount == 0) revert BurnPathDisabled();
        if (collection == address(0)) revert ZeroAddress();
        if (blocked[collection]) revert CollectionBlocked();
        if (tokenIds.length != amount) revert WrongBurnCount();

        for (uint256 i = 0; i < amount; i++) {
            IERC721Burnable(ttt).transferFrom(msg.sender, DEAD_ADDRESS, tokenIds[i]);
        }

        _setWhitelisted(collection, true);
        emit BurnedForWhitelist(msg.sender, collection, tokenIds);
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _setWhitelisted(address collection, bool allowed) internal {
        address[] memory cols = new address[](1);
        cols[0] = collection;
        IWhitelistedPool(fwa).setCollectionsWhitelisted(cols, allowed);
    }
}
