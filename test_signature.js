const crypto = require('crypto');

// 1. Dán CHECKSUM KEY CỦA BẠN vào đây (Phải khớp 100% với PayOS Live Key)
const CHECKSUM_KEY = '5cfebf8bfb06f89af8c51146c12edccabfcf4e485182320b816c40d47f855b41'; 

// 2. Dán CHUỖI DATA TO SIGN ĐÃ ENCODE của bạn vào đây (Lấy từ log)
// Đảm bảo đã thêm expiredAt như hướng dẫn trước đó
const DATA_STRING = 'amount=7000&cancelUrl=https%3A%2F%2Flandregistry.io.vn%2Fpayment-return%3Fhoso_id%3D29%26status%3Dcancel&description=Thanh%20to%C3%A1n%20h%E1%BB%93%20s%C6%A1%20%2329&items=%5B%7B%22name%22%3A%22L%E1%BB%87%20ph%C3%AD%20c%E1%BA%A5p%20GCN%20quy%E1%BB%81n%20s%E1%BB%AD%20d%E1%BB%A5ng%20%C4%91%E1%BA%A5t%22%2C%22quantity%22%3A1%2C%22price%22%3A7000%7D%5D&orderCode=3887914439&returnUrl=https%3A%2F%2Flandregistry.io.vn%2Fpayment-return%3Fhoso_id%3D29%26status%3Dsuccess';

// Hàm tạo Signature
function generateTestSignature(data, key) {
    const signature = crypto.createHmac('sha256', key).update(data).digest('hex');
    return signature;
}

try {
    if (CHECKSUM_KEY.length !== 64) {
        throw new Error('CHECKSUM_KEY phải đúng 64 ký tự hex!');
    }
    
    const expectedSignature = generateTestSignature(DATA_STRING, CHECKSUM_KEY);
    
    console.log('--- KẾT QUẢ KIỂM TRA TỰ ĐỘNG ---');
    console.log('Data String (đã dùng để ký):', DATA_STRING);
    console.log('Checksum Key (đã dùng để ký):', CHECKSUM_KEY);
    console.log('=> Signature TẠO RA:', expectedSignature);
    console.log('-----------------------------------');
    
    // So sánh với Signature bạn đã gửi đi
    // Signature bạn đã gửi: d402e1b636d0ca1d3691415de953e8c54c598ddfb73f91fd3dd2918e513f5d06
    const sentSignature = 'd402e1b636d0ca1d3691415de953e8c54c598ddfb73f91fd3dd2918e513f5d06'; 
    
    if (expectedSignature === sentSignature) {
        console.log('KHỚP! => Signature TẠO RA VÀ SIGNATURE ĐÃ GỬI KHỚP NHAU.');
    } else {
        console.log('KHÔNG KHỚP! => Signature TẠO RA KHÔNG KHỚP VỚI SIGNATURE ĐÃ GỬI.');
    }

} catch (error) {
    console.error('LỖI:', error.message);
}