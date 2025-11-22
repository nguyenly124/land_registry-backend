// routes/payment.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const paymentController = require("../controllers/paymentController");


router.post("/payos", paymentController.createPayOS);
router.post("/payos/webhook", paymentController.payOSWebhook);
module.exports = router;