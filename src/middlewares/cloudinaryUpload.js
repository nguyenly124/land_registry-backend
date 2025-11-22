// config/upload.js
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { v2: cloudinary } = require("cloudinary");
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload avatar
const storageAvatar = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "land_registry/avatars",
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
    transformation: [{ width: 500, height: 500, crop: "limit" }, { quality: "auto" }],
  },
});

const uploadAvatar = multer({
  storage: storageAvatar,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const isValid = allowed.test(file.mimetype);
    cb(isValid ? null : new Error("Chỉ chấp nhận file ảnh!"), isValid);
  },
});

// Upload tài liệu
const storageDocument = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "land_registry/documents",
    allowed_formats: ["pdf", "doc", "docx", "jpg", "jpeg", "png"],
    resource_type: "auto",
  },
});

const uploadDocument = multer({
  storage: storageDocument,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(jpg|jpeg|png|pdf|doc|docx)$/i;
    const isValid = allowedExt.test(file.originalname);

    cb(isValid ? null : new Error("Chỉ chấp nhận file ảnh/tài liệu!"), isValid);
  }
});

module.exports = { uploadAvatar, uploadDocument };