const fs = require('node:fs');
const { uploadDirectory } = require('./runtime');
const UPLOAD_DIR = uploadDirectory();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
module.exports = { UPLOAD_DIR };
