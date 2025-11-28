const express = require('express');
const helmet = require("helmet");
const xssMiddleware = require("./middlewares/xssMiddleware");
const cors = require('cors');
const multer = require('multer');
const errorHandler = require('./middlewares/errorHandler');
const bodyParser = require('body-parser');
const authRouter = require('./routes/authRouter');
const landRouter = require('./routes/landRouter');
const fileRouter = require('./routes/fileRouter');
const userRouter = require('./routes/userRouter');
const dossierRouter = require('./routes/dossierRouter');
const notificationRouter =require('./routes/notificationRouter');
const paymentRouter = require('./routes/paymentRouter');
const webhookRouter = require('./routes/webhook');
const app = express();

// Middleware
app.use( "/payos/webhook",  webhookRouter);
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();  // PayOS cần cái này
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",          
          "'unsafe-eval'",             
          "https://www.googletagmanager.com",
          "https://www.google-analytics.com",
          "https://cdnjs.cloudflare.com",
          "https://cdn.jsdelivr.net"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",           // Tailwind, CSS-in-JS cần
          "https://fonts.googleapis.com"
        ],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "https://www.google-analytics.com", "https://land-registry-backend-gbgu.onrender.com"],
        frameAncestors: ["'none'"],    // thay thế X-Frame-Options
        upgradeInsecureRequests: [],
        blockAllMixedContent: [],
      },
    },
    hsts: {
      maxAge: 31536000,              
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: "deny",
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    permissionsPolicy: {
      features: {
        geolocation: [],
        microphone: [],
        camera: [],
        payment: [],
        fullscreen: ["self"],
      },
    },
    noSniff: true,
    hidePoweredBy: true,
    xssFilter: true,
  }));       // Header bảo mật
app.use(xssMiddleware);  // Chống XSS sâu toàn hệ thống
// app.use(bodyParser.json({ limit: '10mb' }));      
// app.use(bodyParser.urlencoded({ extended: true }));
// Routes

app.use('/auth', authRouter);
app.use('/lands', landRouter);
app.use('/file', fileRouter);
app.use('/user', userRouter);
app.use('/dossier', dossierRouter);
app.use('/notifications',notificationRouter);
app.use("/payment", paymentRouter);
// Test route
app.get('/test-db', (req, res) => {
  res.json({ message: 'Connected successfully' });
});
app.use(errorHandler);
module.exports = app;
