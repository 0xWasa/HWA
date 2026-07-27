// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ERC721} from "solady/src/tokens/ERC721.sol";

/// @title HWA Genesis NFT
/// @notice Optional first-party HyperEVM collection for bootstrapping the pool and the immutable Splitter snapshot.
/// @dev Sequential, gapless IDs and the one-way snapshot freeze make the Splitter denominator auditable.
contract HWAGenesisNFT is ERC721, Ownable {
    uint256 public constant MAX_BATCH_MINT = 100;
    string private _collectionName;
    string private _collectionSymbol;
    string private _baseTokenURI;

    uint256 public immutable maxSupply;
    uint256 public nextTokenId = 1;
    uint256 public currentSupply;
    bool public mintingClosed;
    bool public metadataFrozen;

    event BaseURISet(string baseURI);
    event SnapshotFrozen(uint256 highestMintedTokenId, uint256 currentSupply, string baseURI);

    error InvalidAddress();
    error InvalidConfiguration();
    error MaxSupplyReached();
    error MintingIsClosed();
    error MetadataIsFrozen();
    error BatchTooLarge();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        address owner_
    ) {
        if (owner_ == address(0)) revert InvalidAddress();
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || bytes(baseURI_).length == 0 || maxSupply_ == 0) {
            revert InvalidConfiguration();
        }
        _initializeOwner(owner_);
        _collectionName = name_;
        _collectionSymbol = symbol_;
        _baseTokenURI = baseURI_;
        maxSupply = maxSupply_;
    }

    function name() public view override returns (string memory) {
        return _collectionName;
    }

    function symbol() public view override returns (string memory) {
        return _collectionSymbol;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        return string.concat(_baseTokenURI, _toString(tokenId));
    }

    /// @notice Exposes the exact collection prefix so operators can attest it before the one-way freeze.
    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function getCurrentSupply() external view returns (uint256) {
        return currentSupply;
    }

    function burnedTokenCount() external pure returns (uint256) {
        return 0;
    }

    function highestMintedTokenId() external view returns (uint256) {
        return nextTokenId - 1;
    }

    function snapshotFrozen() external view returns (bool) {
        return mintingClosed && metadataFrozen;
    }

    function mint(address recipient) external onlyOwner returns (uint256 tokenId) {
        tokenId = _mintNext(recipient);
    }

    function batchMint(address[] calldata recipients)
        external
        onlyOwner
        returns (uint256 firstTokenId, uint256 lastTokenId)
    {
        uint256 length = recipients.length;
        if (length == 0 || length > MAX_BATCH_MINT) revert BatchTooLarge();
        firstTokenId = nextTokenId;
        for (uint256 i; i < length; ++i) {
            _mintNext(recipients[i]);
        }
        lastTokenId = nextTokenId - 1;
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        if (bytes(baseURI_).length == 0) revert InvalidConfiguration();
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    /// @notice Permanently closes supply and metadata. Required before this collection can back a Splitter.
    function freezeSnapshot() external onlyOwner {
        if (mintingClosed) revert MintingIsClosed();
        if (currentSupply == 0) revert InvalidConfiguration();
        mintingClosed = true;
        metadataFrozen = true;
        emit SnapshotFrozen(nextTokenId - 1, currentSupply, _baseTokenURI);
    }

    function _mintNext(address recipient) private returns (uint256 tokenId) {
        if (mintingClosed) revert MintingIsClosed();
        if (recipient == address(0)) revert InvalidAddress();
        tokenId = nextTokenId;
        if (tokenId > maxSupply) revert MaxSupplyReached();
        nextTokenId = tokenId + 1;
        ++currentSupply;
        _mint(recipient, tokenId);
    }

    function _toString(uint256 value) private pure returns (string memory result) {
        uint256 digits = 1;
        uint256 cursor = value;
        while (cursor >= 10) {
            cursor /= 10;
            ++digits;
        }
        bytes memory buffer = new bytes(digits);
        while (digits != 0) {
            --digits;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        result = string(buffer);
    }
}
