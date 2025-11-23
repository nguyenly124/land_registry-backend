require("dotenv").config();
const axios = require("axios");
const { initModels } = require("../models/init-models");
const { sequelize } = require("../config/db");
const { HoSo, Payment } = initModels(sequelize);
const { generateSignature } = require("../utils/payos");

const PAYOS_API_URL = "https://api-merchant.payos.vn/v2/payment-requests";

const createPayOSInternal = async (hoso_id, amount, transaction = null) => {
  const hoso = await HoSo.findByPk(hoso_id, { transaction });
  if (!hoso) throw new Error("Hồ sơ không tồn tại");

  // orderCode: number hợp lệ ≤ 9007199254740991
  const orderCode = Math.floor(Math.random() * 9000000000) + 1000000000;

  const bodyForSignature = {
    orderCode,

    amount: Number(amount),
    description: `Lệ phí hồ sơ #${hoso_id}`.slice(0, 25),
    cancelUrl: `${process.env.CLIENT_URL}/payment-return?hoso_id=${hoso_id}&status=cancel`,
    returnUrl: `${process.env.CLIENT_URL}/dossier/${hoso_id}`,
  };

  const signature = generateSignature(bodyForSignature, process.env.PAYOS_CHECKSUM_KEY);

  const payload = { ...bodyForSignature, signature };


  try {
    const response = await axios.post(PAYOS_API_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-client-id": process.env.PAYOS_CLIENT_ID.trim(),
        "x-api-key": process.env.PAYOS_API_KEY.trim(),
      },
      timeout: 20000,
    });

    const result = response.data;
    console.log("PAYOS RESPONSE:", JSON.stringify(result, null, 2));

    if (result.code !== "00") {
      throw new Error(`PayOS lỗi [${result.code}]: ${result.desc}`);
    }

    if (!result.data || !result.data.checkoutUrl) {
      throw new Error("PayOS không trả về checkoutUrl");
    }

    // Lưu Payment vào DB
    await Payment.create(
      {
        hoso_id,
        amount,
        payment_method: "PayOS",
        payment_status: "Đang xử lý",
        vnp_txn_ref: orderCode,
        gateway_data: result.data,
      },
      transaction ? { transaction } : {}
    );

    return { checkoutUrl: result.data.checkoutUrl, orderCode };
  } catch (error) {
    const desc = error.response?.data?.desc || error.message;
    throw new Error(desc);
  }
};


const createPayOS = async (req, res) => {
  try {
    const { hoso_id, amount } = req.body;
    if (!hoso_id)
      return res.status(400).json({ success: false, message: "Thiếu hoso_id" });

    const data = await createPayOSInternal(hoso_id, amount || 7000);

    res.json({
      success: true,
      paymentUrl: data.checkoutUrl,
      orderCode: data.orderCode,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
}
};


const payOSWebhook = async (req, res) => {
  try {
    console.log("\n=== PAYOS WEBHOOK DATA ===");
    console.log(JSON.stringify(req.body, null, 2));
    console.log("===========================\n");

    const { data, signature: receivedSignature } = req.body;
    if (!data) return res.status(400).json({ message: "Missing data" });

    const computedSignature = generateSignature(data, process.env.PAYOS_CHECKSUM_KEY);
    if (computedSignature !== receivedSignature) {
      console.log("❌ Sai chữ ký webhook");
      return res.status(400).send("Invalid signature");
    }

    const orderCode = data.orderCode?.toString();

    if (["PAID", "SUCCESS", "00"].includes((data.status || "").toUpperCase())) {
      await Payment.update(
        {
          payment_status: "Thành công",
          vnp_transaction_no: data?.transactionId || data?.id,
          vnp_pay_date: new Date(),
        },
        { where: { vnp_txn_ref: orderCode } }
      );

      const payment = await Payment.findOne({ where: { vnp_txn_ref: orderCode } });
      if (payment) {
        await HoSo.update({ status: "Chờ xử lý", payment_id: payment.payment_id }, { where: { hoso_id: payment.hoso_id } });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("payOSWebhook error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createPayOS,
  payOSWebhook,
  createPayOSInternal,
};