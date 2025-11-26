
const xssClean = require("xss-clean");
const mongoSanitize = require("express-mongo-sanitize");
const sanitizeHtml = require("sanitize-html");

// Hàm tự sanitize sâu JSON body
const deepSanitize = (obj) => {
  if (!obj) return obj;
  if (typeof obj === "string") {
    return sanitizeHtml(obj, {
      allowedTags: [],
      allowedAttributes: {},
    });
  }
  if (typeof obj === "object") {
    for (let key in obj) {
      obj[key] = deepSanitize(obj[key]);
    }
  }
  return obj;
};

module.exports = (req, res, next) => {
  // Ngăn NoSQL injection (MongoDB)
  mongoSanitize()(req, res, () => {
    // Ngăn script tag
    xssClean()(req, res, () => {
      // Tự sanitize sâu body + query + params
      req.body = deepSanitize(req.body);
      req.query = deepSanitize(req.query);
      req.params = deepSanitize(req.params);
      next();
    });
  });
};
