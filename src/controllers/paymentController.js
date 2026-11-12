require("dotenv").config();
const crypto = require("crypto");
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
    // PayOS gửi webhook dạng { code, desc, success, data, signature }.
    // Chữ ký nằm trong body (trường "signature") và được ký trên object "data"
    // (sắp xếp key theo alphabet → chuỗi key=value&... → HMAC-SHA256 với checksum key).
    // BẮT BUỘC xác thực: không có chữ ký hợp lệ thì không cập nhật gì.
    const { data, signature: receivedSignature } = req.body || {};
    if (!data || !receivedSignature) {
      console.warn("Webhook PayOS thiếu data hoặc signature → từ chối");
      return res.status(400).json({ success: false, message: "Missing data or signature" });
    }

    const computedSignature = generateSignature(data, process.env.PAYOS_CHECKSUM_KEY);
    const expected = Buffer.from(computedSignature, "hex");
    const received = Buffer.from(String(receivedSignature), "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      console.warn(" Sai chữ ký webhook PayOS");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    const orderCode = String(data.orderCode);
    // Update DB khi giao dịch thành công
    if (data.code === "00") {
      const payment = await Payment.findOne({ where: { vnp_txn_ref: orderCode } });
      // Không có đơn tương ứng (vd: webhook kiểm tra khi đăng ký URL trên PayOS) → chỉ xác nhận đã nhận
      if (!payment) return res.json({ success: true });

      // Số tiền phải khớp với đơn đã tạo
      if (Number(payment.amount) !== Number(data.amount)) {
        console.warn(`Webhook PayOS: số tiền không khớp cho orderCode ${orderCode}`);
        return res.json({ success: true });
      }

      // Webhook có thể được gửi lại nhiều lần → chỉ xử lý một lần
      if (payment.payment_status !== "Thành công") {
        await payment.update({
          payment_status: "Thành công",
          vnp_transaction_no: data.reference,
          vnp_pay_date: new Date(),
        });

        const hoso = await HoSo.findByPk(payment.hoso_id);
        if (hoso) {
          const updates = { payment_id: payment.payment_id };
          // Chỉ chuyển sang "Đang xử lý" khi hồ sơ còn chờ, tránh webhook đến muộn
          // ghi đè hồ sơ đã được duyệt / từ chối
          if (hoso.status === "Chờ xử lý") updates.status = "Đang xử lý";
          await hoso.update(updates);
        }
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ success: false, message: "Lỗi server" });
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