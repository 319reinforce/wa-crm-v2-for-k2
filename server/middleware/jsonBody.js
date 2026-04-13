/**
 * JSON body parser middleware
 */
const express = require('express');
const limit = process.env.JSON_BODY_LIMIT || '15mb';
module.exports = express.json({ limit });
