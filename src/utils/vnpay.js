// backend/utils/vnpay.js
const crypto = require('crypto');
const querystring = require('qs');
const dayjs = require('dayjs');

class VNPAY {
  static config = {
    vnp_TmnCode: process.env.VNPAY_TMN_CODE,
    vnp_HashSecret: process.env.VNPAY_HASH_SECRET,
    vnp_Url: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', // TEST
    // vnp_Url: 'https://pay.vnpay.vn/vpcpay.html', // LIVE: bỏ comment khi đi thật
    vnp_ReturnUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  };

  static sortObject(obj) {
    return Object.keys(obj)
      .sort()
      .reduce((result, key) => {
        result[key] = obj[key];
        return result;
      }, {});
  }

  static async createPayment({ hoso_id, amount, ipAddr = '127.0.0.1' }) {
    const tmnCode = this.config.vnp_TmnCode;
    const secretKey = this.config.vnp_HashSecret;
    let vnpUrl = this.config.vnp_Url;

    const date = dayjs();
    const createDate = date.format('YYYYMMDDHHmmss');
    const expireDate = date.add(15, 'minute').format('YYYYMMDDHHmmss');
    const orderId = hoso_id + Date.now().toString().slice(-6); // Đảm bảo duy nhất

    let vnp_Params = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: orderId,
      vnp_OrderInfo: `Thanh toan ho so dat dai #${hoso_id}`,
      vnp_OrderType: '170000',
      vnp_Amount: Math.round(amount) * 100,
      vnp_ReturnUrl: `${this.config.vnp_ReturnUrl.replace(/\/+$/, '')}/payment-return`,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
    };

    vnp_Params = this.sortObject(vnp_Params);
    const signData = querystring.stringify(vnp_Params, { encode: false });
    const signed = crypto.createHmac('sha512', secretKey).update(signData).digest('hex');
    vnp_Params.vnp_SecureHash = signed;

    vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

    return {
      paymentUrl: vnpUrl,
      orderId,
    };
  }

  static verifyReturn(query) {
    let vnp_Params = { ...query };
    const secureHash = vnp_Params.vnp_SecureHash;

    delete vnp_Params.vnp_SecureHash;
    delete vnp_Params.vnp_SecureHashType;

    vnp_Params = this.sortObject(vnp_Params);
    const signData = querystring.stringify(vnp_Params, { encode: false });
    const checkSum = crypto.createHmac('sha512', this.config.vnp_HashSecret).update(signData).digest('hex');

    return {
      isValid: secureHash === checkSum,
      isSuccess: vnp_Params.vnp_ResponseCode === '00',
      orderId: vnp_Params.vnp_TxnRef,
      amount: parseInt(vnp_Params.vnp_Amount) / 100,
      bankCode: vnp_Params.vnp_BankCode,
      transactionNo: vnp_Params.vnp_TransactionNo,
    };
  }
}

module.exports = VNPAY;