// src/services/documentService.js
const axios = require('axios');
const FormData = require('form-data');
global.FormData = FormData; // Fix cho Node.js < 18

const { uploadToIPFS } = require('../blockchain/services/ipfsService');
const { submitDossier } = require('../blockchain/services/ethService');
const { BlockchainTransaction } = require('../models/blockchainTransaction');
const { HoSoDocument } = require('../models/hoSoDocument');

async function processDocument(cloudinaryFile, hoso_id) {
  const { secure_url, original_filename } = cloudinaryFile;

  // 1. Tải file từ Cloudinary
  const response = await axios.get(secure_url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);

  // 2. Upload IPFS
  const ipfsHash = await uploadToIPFS(buffer, original_filename);

  // 3. Ghi blockchain
  const txHash = await submitDossier(`DOS-${hoso_id}`, ipfsHash);

  // 4. Lưu DB
  await HoSoDocument.create({
    hoso_id,
    doc_name: original_filename,
    cloudinary_url: secure_url,
    ipfs_hash: ipfsHash,
    blockchain_synced: true,
  });

  await BlockchainTransaction.create({
    hoso_id,
    action: 'DOCUMENT_SUBMITTED',
    ipfs_hash: ipfsHash,
    hash_value: txHash,
    status: 'CONFIRMED',
  });

  return { ipfsHash, txHash };
}

module.exports = { processDocument };