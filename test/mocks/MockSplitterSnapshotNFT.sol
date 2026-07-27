// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract MockSplitterSnapshotNFT {
    uint256 public currentSupply;
    uint256 public burnedTokenCount;
    mapping(uint256 tokenId => address owner) private _ownerOf;
    bool public snapshotFrozen = true;

    function seed(uint256 tokenId, address owner) external {
        require(_ownerOf[tokenId] == address(0) && owner != address(0));
        _ownerOf[tokenId] = owner;
        ++currentSupply;
    }

    function transfer(uint256 tokenId, address to) external {
        require(msg.sender == _ownerOf[tokenId] && to != address(0));
        _ownerOf[tokenId] = to;
    }

    function burn(uint256 tokenId) external {
        require(msg.sender == _ownerOf[tokenId]);
        delete _ownerOf[tokenId];
        --currentSupply;
        ++burnedTokenCount;
    }

    function ownerOf(uint256 tokenId) external view returns (address owner) {
        owner = _ownerOf[tokenId];
        require(owner != address(0));
    }

    function getCurrentSupply() external view returns (uint256) {
        return currentSupply;
    }
}
