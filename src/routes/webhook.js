// routes/webhook.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const paymentController = require("../controllers/paymentController");


router.post(
  "/",
  express.raw({ type: "*/*" }),     // BẮT BUỘC
  (req, res, next) => {
    // Vì dùng express.raw nên body là Buffer
    req.rawBody = req.body.toString();  
    try {
      req.body = JSON.parse(req.rawBody); // parse thủ công
    } catch (e) {
      console.error("Parse webhook body error:", e);
    }
    next();
  },
  paymentController.payOSWebhook
);

module.exports = router;