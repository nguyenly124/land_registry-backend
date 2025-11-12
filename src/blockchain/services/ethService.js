const { ethers } = require('ethers');
const config = require('../config/polygon.js');
const contractABI = require('../contract/LandRegistry.json');


const provider = new ethers.JsonRpcProvider(config.rpcUrl);
const wallet = new ethers.Wallet(config.privateKey, provider);
const contract = new ethers.Contract(config.contractAddress, contractABI, wallet);

provider.resolveName = async () => null;
provider.getResolver = async () => null;
async function submitDossier(dossierId, ipfsHash) {
  const tx = await contract.submitDossier(dossierId, ipfsHash);
  const receipt = await tx.wait();
  return receipt.hash ;
}

async function transferOwnership(parcelCode, newOwnerAddress, ipfsHash) {
  try {
    console.log('[ETH] Gọi contract.transferOwnership:', { parcelCode, newOwnerAddress, ipfsHash });

    // Gửi giao dịch
    const tx = await contract.transferOwnership(parcelCode, newOwnerAddress, ipfsHash);
    console.log('[ETH] Gửi thành công, tx.hash:', tx.hash);
    const receipt = await tx.wait();
    return receipt.hash || receipt.transactionHash;
  } catch (error) {
    throw error; 
  }
}

module.exports = { submitDossier, transferOwnership };