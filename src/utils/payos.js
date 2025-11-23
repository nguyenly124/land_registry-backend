const crypto = require("crypto");

function sortObjDataByKey(object = {}) {
  return Object.keys(object)
    .sort()
    .reduce((obj, key) => {
      obj[key] = object[key];
      return obj;
    }, {});
}

function convertObjToQueryStr(object = {}) {
  return Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .map((key) => {
      let value = object[key];

      if (Array.isArray(value)) {
        value = JSON.stringify(value.map((v) => sortObjDataByKey(v)));
      }

      if (value === null || value === undefined) value = "";

      return `${key}=${value}`;
    })
    .join("&");
}

function generateSignature(data = {}, checksumKey) {
  const sortedData = sortObjDataByKey(data);
  const queryStr = convertObjToQueryStr(sortedData);
  return crypto.createHmac("sha256", checksumKey).update(queryStr).digest("hex");
}

module.exports = { generateSignature };