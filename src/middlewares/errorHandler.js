//Xử lý lỗi từ cả validate, upload (multer) và Sequelize.
const multer = require('multer');

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'File quá lớn! Ảnh đại diện tối đa 5MB, tài liệu tối đa 10MB.',
  LIMIT_UNEXPECTED_FILE: "Tên field file không hợp lệ! Dùng 'avatar' cho ảnh đại diện, 'files' cho tài liệu.",
};

const errorHandler = (err, req, res, next) => {
  // Response đã gửi một phần → giao lại cho Express xử lý, không gửi lần 2
  if (res.headersSent) {
    return next(err);
  }

  // Lỗi upload phải kiểm tra TRƯỚC nhánh 500 chung
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: MULTER_MESSAGES[err.code] || 'Lỗi xử lý file upload.',
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(400).json({
      success: false,
      message: 'Tên người dùng đã tồn tại',
    });
  }
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu không hợp lệ',
      errors: err.errors.map(e => e.message),
    });
  }

  // Lỗi có chủ đích mang mã 4xx (vd: fileFilter từ chối loại file, JSON sai cú pháp)
  // → message an toàn để hiển thị cho người dùng
  const status = err.status || err.statusCode;
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      success: false,
      message: err.expose === false ? 'Yêu cầu không hợp lệ.' : err.message,
    });
  }

  // Lỗi không lường trước: chỉ ghi log ở server, KHÔNG trả chi tiết lỗi nội bộ cho client
  console.error(err.stack || err);
  return res.status(500).json({
    success: false,
    message: 'Lỗi server',
  });
};

module.exports = errorHandler;
