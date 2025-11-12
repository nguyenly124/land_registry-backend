// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LandRegistry {
    address public admin;
    modifier onlyAdmin() { require(msg.sender == admin, "Not admin"); _; }

    struct Dossier {
        string dossierId;
        string ipfsHash;
        string status;
        uint256 timestamp;
    }

    mapping(string => Dossier) public dossiers;
    mapping(string => address) public landOwners;
    mapping(string => string[]) public ownershipHistory;

    event DossierSubmitted(string dossierId, string ipfsHash);
    event OwnershipTransferred(string parcelCode, address from, address to, string ipfsHash);

    constructor() { admin = msg.sender; }

    function submitDossier(string memory _dossierId, string memory _ipfsHash) external {
        dossiers[_dossierId] = Dossier(_dossierId, _ipfsHash, "PENDING", block.timestamp);
        emit DossierSubmitted(_dossierId, _ipfsHash);
    }

    function transferOwnership(
        string memory _parcelCode,
        address _newOwner,
        string memory _ipfsHash
    ) external onlyAdmin {
        address old = landOwners[_parcelCode];
        landOwners[_parcelCode] = _newOwner;
        ownershipHistory[_parcelCode].push(_ipfsHash);
        emit OwnershipTransferred(_parcelCode, old, _newOwner, _ipfsHash);
    }
}