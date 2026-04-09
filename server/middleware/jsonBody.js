/**
 * JSON body parser middleware — 3MB limit
 */
const express = require('express');
module.exports = express.json({ limit: '3mb' });
