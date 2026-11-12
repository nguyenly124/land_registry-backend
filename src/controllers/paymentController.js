require("dotenv").config();
const axios = require("axios");
const { initModels } = require("../models/init-models");
const { sequelize } = require("../config/db");
const { HoSo, Payment } = initModels(sequelize);
const { generateSignature } = require("../utils/payos");

const PAYOS_API_URL = "https://api-merchant.payos.vn/v2/payment-requests";

// 1. HÀM TẠO THANH TOÁN NỘI BỘ (DÙNG CHUNG)
const createPayOSInternal = async (hoso_id, amount, transaction = null) => {
  const hoso = await HoSo.findByPk(hoso_id, { transaction });
  if (!hoso) throw new Error("Hồ sơ không tồn tại");
  // orderCode: number hợp lệ ≤ 9007199254740991
  const orderCode = Math.floor(Math.random() * 9000000000) + 1000000000;
  /*  Tạo object dữ liệu dùng để ký chữ ký bảo mật, description bị giới hạn nên chỉ lấy tối đa 25 ký tự  */
  const bodyForSignature = {
    orderCode,
    amount: Number(amount),
    description: `Lệ phí hồ sơ #${hoso_id}`.slice(0, 25),
    cancelUrl: `${process.env.CLIENT_URL}/dossier/${hoso_id}#payos`,
    returnUrl: `${process.env.CLIENT_URL}/dossier/${hoso_id}#payos`,
  };
 /*  Tạo chữ ký bảo mật bằng checksum key,  PayOS dùng chữ ký này để xác minh request hợp lệ  */
  const signature = generateSignature(bodyForSignature, process.env.PAYOS_CHECKSUM_KEY);
 // Payload cuối cùng gửi sang PayOS sẽ bao gồm dữ liệu gốc + chữ ký bảo mật
  const payload = { ...bodyForSignature, signature };
  try {
    /*  Gửi request POST sang PayOS để tạo link thanh toán  */
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
// Nếu PayOS trả lỗi thì dừng luôn, không tạo Payment trong DB
    if (result.code !== "00") {
      throw new Error(`PayOS lỗi [${result.code}]: ${result.desc}`);
    }
 // Nếu không có checkoutUrl thì coi như lỗi, vì không thể tiếp tục quy trình thanh toán được nữa
    if (!result.data || !result.data.checkoutUrl) {
      throw new Error("PayOS không trả về checkoutUrl");
    }
    /*  Lưu thông tin thanh toán vào database, trước khi người dùng thực hiện thanh toán */
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
  // Trả checkout URL về frontend để redirect người dùng sang PayOS
    return { checkoutUrl: result.data.checkoutUrl, orderCode };
  } catch (error) {
    const desc = error.response?.data?.desc || error.message;
    throw new Error(desc);
  }
};
// 2. API TẠO THANH TOÁN TỪ FRONTEND GỌI VÀO

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

// 3. API WEBHOOK NHẬN CALLBACK TỪ PAYOS
const payOSWebhook = async (req, res) => {
  try {
    const receivedSignature = req.headers["x-payos-signature"];
    // Nếu không có signature, vẫn tiếp tục update DB
    if (!receivedSignature) {
      console.warn("⚠ Không có x-payos-signature, bỏ qua verify tạm thời");
    } else {
      // Nếu có signature → verify như bình thường
      const computedSignature = generateSignature(req.rawBody, process.env.PAYOS_CHECKSUM_KEY);
      if (computedSignature !== receivedSignature) {
        console.log(" Sai chữ ký");
        return res.status(400).send("Invalid signature");
      }
    }
    const data = req.body.data;
    if (!data) return res.status(400).send("Missing data");
    const orderCode = String(data.orderCode);
    const code = data.code;
    // Update DB khi giao dịch thành công
    if (code === "00") {
      const [updateCount] = await Payment.update(
        {
          payment_status: "Thành công",
          vnp_transaction_no: data.reference,
          vnp_pay_date: new Date(),
        },
        { where: { vnp_txn_ref: orderCode } }
      );
      // console.log("Update count:", updateCount);
      const payment = await Payment.findOne({ where: { vnp_txn_ref: orderCode } });
      if (payment) {
        await HoSo.update(
          { status: "Đang xử lý", payment_id: payment.payment_id },
          { where: { hoso_id: payment.hoso_id } }
        );
        // console.log("✔ Hồ sơ cập nhật:", payment.hoso_id);
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ message: err.message });
  }
};


// 4. API LẤY TRẠNG THÁI THANH TOÁN CỦA HỒ SƠ
// Frontend gọi sau khi PayOS redirect về, để lấy kết quả thật từ DB (do webhook cập nhật)
// thay vì tin vào tham số trên URL.
const getPaymentStatus = async (req, res) => {
  try {
    const { hoso_id } = req.params;
    const { orderCode } = req.query;
    const { id: userId, role } = req.user;

    if (!/^\d+$/.test(String(hoso_id))) {
      return res.status(400).json({ success: false, message: "hoso_id không hợp lệ" });
    }
    if (orderCode !== undefined && !/^\d+$/.test(String(orderCode))) {
      return res.status(400).json({ success: false, message: "orderCode không hợp lệ" });
    }

    const hoso = await HoSo.findByPk(hoso_id, { attributes: ["hoso_id", "account_id"] });
    if (!hoso) {
      return res.status(404).json({ success: false, message: "Hồ sơ không tồn tại" });
    }
    // Người dân chỉ xem được thanh toán của hồ sơ mình nộp
    if (role !== "Cán bộ" && hoso.account_id !== userId) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền xem thanh toán của hồ sơ này" });
    }

    const where = { hoso_id };
    if (orderCode !== undefined) where.vnp_txn_ref = String(orderCode);

    const payment = await Payment.findOne({
      where,
      order: [["created_at", "DESC"]],
      attributes: ["payment_status", "amount", "vnp_txn_ref", "vnp_pay_date"],
    });

    return res.json({
      success: true,
      data: payment
        ? {
            payment_status: payment.payment_status,
            amount: payment.amount,
            order_code: payment.vnp_txn_ref,
            paid_at: payment.vnp_pay_date,
          }
        : null,
    });
  } catch (err) {
    console.error("getPaymentStatus error:", err);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

module.exports = {
  createPayOS,
  payOSWebhook,
  createPayOSInternal,
  getPaymentStatus,
};