// utils/NotificationEvent.js
// Gửi thông báo (lưu DB + realtime socket + email) khi hồ sơ thay đổi trạng thái.
// Nguyên tắc:
//  - Mỗi sự kiện được emit ĐÚNG MỘT LẦN từ controller (sau khi commit transaction).
//  - Mỗi người liên quan nhận đúng một thông báo, nội dung là văn bản thuần (không HTML)
//    vì frontend hiển thị dạng text; email đã có template HTML riêng trong emailService.
//  - Mọi handler bọc trong safe(): lỗi chỉ ghi log, không làm sập tiến trình Node.
const EventEmitter = require('events');
const { createAndNotify } = require('../services/emailService');
const { UserProfile, Account, HoSo, LandParcel } =
  require('../models/init-models')(require('../config/db').sequelize);

class NotificationEvent extends EventEmitter {}

const notificationEvent = new NotificationEvent();

// Bọc handler async: listener của EventEmitter không được await,
// nên lỗi không bắt sẽ thành unhandled rejection và dừng tiến trình (Node >= 15).
const safe = (event, handler) => {
  notificationEvent.on(event, async (payload) => {
    try {
      await handler(payload);
    } catch (error) {
      console.error(`[Notification] Lỗi khi xử lý ${event}:`, error);
    }
  });
};

// Gửi thông báo cho 1 tài khoản, kèm email nếu hồ sơ người dùng có email
const notifyUser = async (io, accountId, message, hosoId) => {
  if (!accountId) return;
  const profile = await UserProfile.findOne({ where: { account_id: accountId } });
  const emailTo = profile?.email
    ? { email: profile.email, name: profile.full_name || 'Quý khách' }
    : null;
  await createAndNotify(io, accountId, message, hosoId, emailTo);
};

// Gửi thông báo cho tất cả cán bộ (chỉ trong hệ thống, không gửi email)
const notifyAllStaff = async (io, message, hosoId) => {
  const staffList = await Account.findAll({ where: { role: 'Cán bộ' }, attributes: ['account_id'] });
  for (const staff of staffList) {
    await createAndNotify(io, staff.account_id, message, hosoId);
  }
};

// ĐĂNG KÝ CÁC SỰ KIỆN

// Người dân nộp hồ sơ → chỉ báo người nộp.
// (Cán bộ được báo khi hồ sơ đã thanh toán — xem 'hoso.paid' — vì hồ sơ chưa thanh toán
//  không hiển thị trong danh sách xử lý của cán bộ.)
safe('hoso.submitted', async ({ io, accountId, type, hosoId, parcelId }) => {
  const message = parcelId
    ? `Hồ sơ "${type}" #${hosoId} cho thửa đất #${parcelId} đã được nộp. Vui lòng thanh toán lệ phí để hồ sơ được chuyển cho cán bộ xử lý.`
    : `Hồ sơ "${type}" #${hosoId} đã được nộp. Vui lòng thanh toán lệ phí để hồ sơ được chuyển cho cán bộ xử lý.`;
  await notifyUser(io, accountId, message, hosoId);
});

// Webhook PayOS xác nhận thanh toán → báo người nộp + toàn bộ cán bộ
safe('hoso.paid', async ({ io, hosoId }) => {
  const hoso = await HoSo.findByPk(hosoId, { attributes: ['hoso_id', 'account_id', 'type'] });
  if (!hoso) return;

  await notifyUser(
    io,
    hoso.account_id,
    `Đã nhận lệ phí hồ sơ #${hosoId}. Hồ sơ đang chờ cán bộ xử lý.`,
    hosoId
  );
  await notifyAllStaff(io, `Hồ sơ mới #${hosoId} (${hoso.type}) đã thanh toán, chờ xử lý.`, hosoId);
});

// Cán bộ duyệt hồ sơ → báo người nộp; nếu chuyển nhượng thì báo thêm người nhận
safe('hoso.approved', async ({ io, hosoId }) => {
  const hoso = await HoSo.findByPk(hosoId, {
    include: [{ model: LandParcel, as: 'parcel', attributes: ['parcel_code', 'certificate_number'] }]
  });
  if (!hoso) return;

  const parcelCode = hoso.parcel?.parcel_code || '';
  const certificate = hoso.parcel?.certificate_number;
  const isTransfer = hoso.type === 'Chuyển nhượng' && hoso.receiver_info;

  // 1. Người nộp
  const applicantMessage = isTransfer
    ? `Hồ sơ chuyển nhượng #${hosoId} đã được duyệt. Quyền sử dụng thửa đất ${parcelCode} đã được chuyển cho ${hoso.receiver_info.full_name}.`
    : `Hồ sơ #${hosoId} đã được duyệt. Thửa đất ${parcelCode} đã được cấp Giấy chứng nhận${certificate ? ` số ${certificate}` : ''}.`;
  await notifyUser(io, hoso.account_id, applicantMessage, hosoId);

  // 2. Người nhận chuyển nhượng — tài khoản đã được approveHoSo tạo/tìm theo số CCCD
  if (isTransfer) {
    const receiver = await Account.findOne({
      where: { username: hoso.receiver_info.id_number },
      attributes: ['account_id']
    });
    if (!receiver) {
      console.warn(`[Notification] Không tìm thấy tài khoản người nhận của hồ sơ #${hosoId}`);
      return;
    }
    await notifyUser(
      io,
      receiver.account_id,
      `Bạn đã trở thành chủ sở hữu mới của thửa đất ${parcelCode} (hồ sơ chuyển nhượng #${hosoId} đã được duyệt).`,
      hosoId
    );
  }
});

// Cán bộ từ chối hồ sơ → báo người nộp kèm lý do
safe('hoso.rejected', async ({ io, accountId, hosoId, reason }) => {
  await notifyUser(io, accountId, `Hồ sơ #${hosoId} bị từ chối. Lý do: ${reason || 'Không rõ'}.`, hosoId);
});

// Cán bộ yêu cầu bổ sung → báo người nộp kèm nội dung cần bổ sung
safe('hoso.supplement_requested', async ({ io, accountId, hosoId, reason }) => {
  await notifyUser(
    io,
    accountId,
    `Hồ sơ #${hosoId} cần bổ sung tài liệu. Nội dung: ${reason || 'Không rõ'}.`,
    hosoId
  );
});

module.exports = {
  emit: (event, data) => notificationEvent.emit(event, data)
};
