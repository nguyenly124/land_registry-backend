// routes/webhook.js
// const PayOS = require('../utils/payos');

// router.post('/payos/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
//   const signature = req.headers['x-payos-signature'];

//   if (!PayOS.verifyWebhookSignature(req.body, signature)) {
//     return res.status(400).send('Signature không hợp lệ');
//   }

//   const data = JSON.parse(req.body.toString());

//   if (data.code === '00') {
//     // Thành công → cập nhật Payment + HoSo
//     await Payment.update(
//       { payment_status: 'Thành công', gateway_data: data },
//       { where: { vnp_txn_ref: data.orderCode.toString() } }
//     );
//   }

//   res.json({ success: true });
// });