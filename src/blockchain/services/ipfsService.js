// src/blockchain/services/ipfsService.js
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

async function uploadToIPFS(buffer, filename) {
  const form = new FormData();
  form.append('file', buffer  , filename);

  const metadata = JSON.stringify({
    name: filename,
    keyvalues: { uploadedAt: new Date().toISOString() }
  });
  form.append('pinataMetadata', metadata);
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  try {
    const response = await axios.post(PINATA_PIN_FILE_URL, form, {
      headers: {
        ...form.getHeaders(),
        pinata_api_key: process.env.PINATA_API_KEY,
        pinata_secret_api_key: process.env.PINATA_SECRET_API_KEY,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return response.data.IpfsHash;
  } catch (error) {
    console.error('IPFS Upload Error:', error.response?.data || error.message);
    throw new Error('Không thể upload lên IPFS');
  }
}

module.exports = { uploadToIPFS };