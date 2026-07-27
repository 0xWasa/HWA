// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ERC721} from "solady/src/tokens/ERC721.sol";

/// @title FWATestnetNFT
/// @notice Controlled ERC-721 used only to exercise HWA end-to-end on HyperEVM testnet.
/// @dev Deploy separate instances for the Splitter snapshot, normal gameplay and hostile transfers.
///      Chain guards prevent this test fixture from being deployed on HyperEVM mainnet.
contract FWATestnetNFT is ERC721, Ownable {
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    string private _collectionName;
    string private _collectionSymbol;
    string private _baseTokenURI;

    uint256 public immutable maxSupply;
    uint256 public nextTokenId = 1;
    uint256 public currentSupply;
    uint256 public burnedTokenCount;
    bool public mintingClosed;
    bool public transfersBlocked;

    mapping(uint256 tokenId => bool burned) public isBurned;

    event MintingClosed(uint256 highestMintedTokenId, uint256 currentSupply);
    event TokenReminted(uint256 indexed tokenId, address indexed recipient);
    event TransfersBlockedSet(bool blocked);
    event BaseURISet(string baseURI);

    error WrongChain(uint256 actual);
    error InvalidAddress();
    error InvalidMaxSupply();
    error MaxSupplyReached();
    error MintingIsClosed();
    error TokenWasNotBurned();
    error TestTransfersBlocked();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        address owner_
    ) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != LOCAL_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (owner_ == address(0)) revert InvalidAddress();
        if (maxSupply_ == 0) revert InvalidMaxSupply();

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
        return _baseTokenURI;
    }

    function getCurrentSupply() external view returns (uint256) {
        return currentSupply;
    }

    function highestMintedTokenId() external view returns (uint256) {
        return nextTokenId - 1;
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
        if (length == 0) revert InvalidAddress();

        firstTokenId = nextTokenId;
        for (uint256 i; i < length;) {
            _mintNext(recipients[i]);
            unchecked {
                ++i;
            }
        }
        lastTokenId = nextTokenId - 1;
    }

    /// @notice Permanently prevents minting and reminting token IDs.
    function closeMinting() external onlyOwner {
        if (mintingClosed) revert MintingIsClosed();
        mintingClosed = true;
        emit MintingClosed(nextTokenId - 1, currentSupply);
    }

    function burn(uint256 tokenId) external {
        _burn(msg.sender, tokenId);
        isBurned[tokenId] = true;
        unchecked {
            --currentSupply;
            ++burnedTokenCount;
        }
    }

    /// @notice Restores a burned snapshot ID to test the same ownerOf-driven rights used by FWA.
    function remint(address recipient, uint256 tokenId) external onlyOwner {
        if (mintingClosed) revert MintingIsClosed();
        if (recipient == address(0)) revert InvalidAddress();
        if (!isBurned[tokenId]) revert TokenWasNotBurned();

        isBurned[tokenId] = false;
        unchecked {
            ++currentSupply;
            --burnedTokenCount;
        }
        _mint(recipient, tokenId);
        emit TokenReminted(tokenId, recipient);
    }

    function snapshotFrozen() external view returns (bool) {
        return mintingClosed;
    }

    function setTransfersBlocked(bool blocked) external onlyOwner {
        transfersBlocked = blocked;
        emit TransfersBlockedSet(blocked);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        _baseTokenURI = baseURI_;
        emit BaseURISet(baseURI_);
    }

    function _mintNext(address recipient) internal returns (uint256 tokenId) {
        if (mintingClosed) revert MintingIsClosed();
        if (recipient == address(0)) revert InvalidAddress();

        tokenId = nextTokenId;
        if (tokenId > maxSupply) revert MaxSupplyReached();

        unchecked {
            nextTokenId = tokenId + 1;
            ++currentSupply;
        }
        _mint(recipient, tokenId);
    }

    function _beforeTokenTransfer(address from, address to, uint256) internal view override {
        if (transfersBlocked && from != address(0) && to != address(0)) revert TestTransfersBlocked();
    }
}
