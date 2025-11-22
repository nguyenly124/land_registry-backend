require("dotenv").config();
const crypto = require("crypto");
const { initModels } = require('../models/init-models');
const { sequelize } = require('../config/db');
const { HoSo, Payment } = initModels(sequelize);
const axios = require('axios');
const PAYOS_API_URL = "https://api-merchant.payos.vn/v2/payment-requests";

// Tạo yêu cầu thanh toán PayOS
// exports.createPayOS = async (req, res, hoso_id_arg = null, amountOverride = null, transaction = null) => {
//   try {
//     console.log("\n=== BẮT ĐẦU TẠO GIAO DỊCH PAYOS ===");

//     // Nếu gọi qua API → lấy từ req.body
//     let hoso_id;
//     if (req && res) {
//       console.log("=== GỌI QUA API ===");
//       console.log("REQ BODY:", req.body);

//       hoso_id = req.body.hoso_id;
//       amountOverride = req.body.amount || null;
//     } else {
//       console.log("=== GỌI NỘI BỘ ===");
//       hoso_id = hoso_id_arg;
//     }

//     console.log("Hồ sơ ID:", hoso_id);

//     const hoso = await HoSo.findByPk(hoso_id, { transaction });
//     if (!hoso) throw new Error("Hồ sơ không tồn tại");

//     const amount = amountOverride || hoso.le_phi || 7000;
//     const orderCode = Number(Date.now().toString().slice(-10));

//     console.log("Amount:", amount);
//     console.log("OrderCode:", orderCode);

//     const body = {
//       orderCode,
//       amount,
//       description: `Lệ phí hồ sơ đất đai #${hoso_id}`,
//       returnUrl: `${process.env.FRONTEND_URL}/payment-return?hoso_id=${hoso_id}&status=success`,
//       cancelUrl: `${process.env.FRONTEND_URL}/payment-return?hoso_id=${hoso_id}&status=cancel`,
//       items: [
//         { name: "Lệ phí hồ sơ đất đai", quantity: 1, price: amount }
//       ],
//     };

//     const dataToSign =
//       `amount=${body.amount}` +
//       `&cancelUrl=${encodeURIComponent(body.cancelUrl)}` +
//       `&description=${encodeURIComponent(body.description)}` +
//       `&orderCode=${body.orderCode}` +
//       `&returnUrl=${encodeURIComponent(body.returnUrl)}`;

//     console.log("DATA TO SIGN:", dataToSign);

//     const signature = crypto
//       .createHmac("sha256", process.env.PAYOS_CHECKSUM_KEY.trim())
//       .update(dataToSign)
//       .digest("hex");

//     console.log("SIGNATURE:", signature);

//     // Gửi tới PayOS Sandbox
//     const response = await fetch(PAYOS_API_URL, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "x-client-id": process.env.PAYOS_CLIENT_ID.trim(),
//         "x-api-key": process.env.PAYOS_API_KEY.trim(),
//       },
//       body: JSON.stringify({ ...body, signature }),
//     });

//     const result = await response.json();
//     console.log("=== PAYOS RESPONSE ===", JSON.stringify(result, null, 2));

//     if (result.code !== "00") {
//       throw new Error(`PayOS lỗi [${result.code}]: ${result.desc || result.message}`);
//     }

//     // Lưu giao dịch vào DB
//     const opts = transaction ? { transaction } : {};

//     await Payment.create(
//       {
//         hoso_id,
//         amount,
//         payment_method: "PayOS",
//         payment_status: "Đang xử lý",
//         vnp_txn_ref: orderCode.toString(),
//         gateway_data: result.data,
//       },
//       opts
//     );

//     console.log("=== GIAO DỊCH PAYOS TẠO THÀNH CÔNG ===");

//     // Nếu gọi qua API → trả JSON
//     if (req && res) {
//       return res.json({
//         success: true,
//         paymentUrl: result.data.checkoutUrl,
//       });
//     }

//     // Nếu gọi nội bộ → trả object
//     return result.data;

//   } catch (error) {
//     console.error("LỖI PAYOS:", error);

//     if (req && res) {
//       return res.status(400).json({ success: false, message: error.message });
//     }

//     throw error;
//   }
// };
const createPayOSInternal = async (hoso_id, amount, transaction = null) => {
  const hoso = await HoSo.findByPk(hoso_id, { transaction });
  if (!hoso) throw new Error("Hồ sơ không tồn tại");

  const orderCode = Number(Date.now().toString().slice(-10));

  const body = {
    orderCode,
    amount,
    description: `Lệ phí hồ sơ đất đai #${hoso_id}`,
    returnUrl: `${process.env.FRONTEND_URL}/payment-return?hoso_id=${hoso_id}&status=success`,
    cancelUrl: `${process.env.FRONTEND_URL}/payment-return?hoso_id=${hoso_id}&status=cancel`,
    items: [{ name: "Lệ phí cấp GCN", quantity: 1, price: amount }],
  };

  const rawData =
    `${body.amount}${body.description}${body.orderCode}${body.returnUrl}${body.cancelUrl}`;

  const signature = crypto
    .createHmac("sha256", process.env.PAYOS_CHECKSUM_KEY.trim())
    .update(rawData)
    .digest("hex");

  try {
    const response = await axios.post(PAYOS_API_URL, {
      ...body,
      signature
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.PAYOS_CLIENT_ID.trim(),
        'x-api-key': process.env.PAYOS_API_KEY.trim(),
      },
      
       timeout: 50000 
      
    });

    const result = response.data;

    if (result.code !== "00") {
      throw new Error(`PayOS lỗi [${result.code}]: ${result.desc}`);
    }

    const opts = transaction ? { transaction } : {};
    await Payment.create({
      hoso_id,
      amount,
      payment_method: "PayOS",
      payment_status: "Đang xử lý",
      vnp_txn_ref: orderCode.toString(),
      gateway_data: result.data,
    }, opts);

    return result.data;

  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      throw new Error("Không kết nối được PayOS – Kiểm tra mạng hoặc đổi sang 4G");
    }
    throw new Error(error.response?.data?.desc || error.message);
  }
};
exports.createPayOS = async (req, res) => {
  try {
    const { hoso_id, amount } = req.body;
    if (!hoso_id) return res.status(400).json({ success: false, message: "Thiếu hoso_id" });

    const data = await createPayOSInternal(hoso_id, amount || 7000);
    return res.json({ success: true, paymentUrl: data.checkoutUrl });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};
// Webhook cập nhật trạng thái thanh toán
exports.payOSWebhook = async (req, res) => {
  console.log("\n=== PAYOS WEBHOOK DATA ===");
  console.log(JSON.stringify(req.body, null, 2));
  console.log("===========================\n");

  const { code, data } = req.body;

  if (code === "00" || data?.status === "PAID") {
    await Payment.update(
      {
        payment_status: "Thành công",
        vnp_transaction_no: data?.transactionId || data?.id,
        vnp_pay_date: new Date(),
      },
      { where: { vnp_txn_ref: data.orderCode.toString() } }
    );

    const payment = await Payment.findOne({ where: { vnp_txn_ref: data.orderCode.toString() } });
    if (payment) {
      await HoSo.update({ status: "Chờ xử lý" }, { where: { hoso_id: payment.hoso_id } });
    }
  }

  res.json({ success: true });
};

module.exports = {
  createPayOS: exports.createPayOS,
  payOSWebhook: exports.payOSWebhook,
  createPayOSInternal
};
