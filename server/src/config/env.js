const path = require('node:path');
const dotenv = require('dotenv');

// Explicit process environment wins, followed by production root .env, then legacy server/.env.
// Paths are independent of PM2's current working directory.
dotenv.config({ path: path.resolve(__dirname, '../../..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });
