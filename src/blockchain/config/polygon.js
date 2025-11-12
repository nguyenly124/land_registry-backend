// src/blockchain/config/polygon.js
require('dotenv').config();

// === CẤU HÌNH MẠNG POLYGON AMOY (TESTNET MỚI) ===
const amoy = {
  rpcUrl: 'https://rpc-amoy.polygon.technology',
  chainId: 80002,
  contractAddress: process.env.CONTRACT_ADDRESS,
  privateKey: process.env.ADMIN_PRIVATE_KEY,
  explorer: 'https://amoy.polygonscan.com',
  name: 'Polygon Amoy Testnet',
};

// === CẤU HÌNH MẠNG POLYGON MAINNET (KHI TRIỂN KHAI THỰC TẾ) ===
const mainnet = {
  rpcUrl: 'https://polygon-rpc.com',
  chainId: 137,
  contractAddress: process.env.CONTRACT_ADDRESS,
  privateKey: process.env.ADMIN_PRIVATE_KEY,
  explorer: 'https://polygonscan.com',
  name: 'Polygon Mainnet',
};

// === CHỌN MẠNG THEO NODE_ENV ===
const isProduction = process.env.NODE_ENV === 'production';
const config = isProduction ? mainnet : amoy;

// === KIỂM TRA BIẾN MÔI TRƯỜNG ===
if (!config.privateKey) {
  throw new Error(
    `ADMIN_PRIVATE_KEY không được tìm thấy trong .env (mạng: ${config.name})`
  );
}

if (!config.contractAddress && !isProduction) {
  console.warn(
    `CONTRACT_ADDRESS chưa được thiết lập (mạng: ${config.name}). ` +
    `Hãy deploy contract trước khi chạy backend.`
  );
} else if (!config.contractAddress) {
  throw new Error(
    `CONTRACT_ADDRESS không được tìm thấy trong .env (mạng: ${config.name})`
  );
}

console.log(`Blockchain: ${config.name} (Chain ID: ${config.chainId})`);
module.exports = config;