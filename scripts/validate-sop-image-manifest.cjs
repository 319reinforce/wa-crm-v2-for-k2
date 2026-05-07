#!/usr/bin/env node
/*
 * Validate SOP image asset manifests.
 *
 * Usage:
 *   node scripts/validate-sop-image-manifest.cjs public/sop-assets/may-2026/manifest.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const manifestPath = process.argv[2] || 'public/sop-assets/may-2026/manifest.json';
const root = process.cwd();
const resolvedManifestPath = path.resolve(root, manifestPath);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`Failed to read JSON ${filePath}: ${err.message}`);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readPngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readImageSize(filePath) {
  const buffer = fs.readFileSync(filePath);
  return readPngSize(buffer) || readJpegSize(buffer);
}

const manifest = readJson(resolvedManifestPath);
const manifestDir = path.dirname(resolvedManifestPath);
const errors = [];
const warnings = [];
const urls = new Map();
const ownerLabels = new Map();

if (!manifest || typeof manifest !== 'object') {
  fail('Manifest must be a JSON object');
}

if (!manifest.asset_version) errors.push('asset_version is required');
if (!manifest.sourceTitle) warnings.push('sourceTitle is recommended');
if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
  errors.push('items must be a non-empty array');
}

(manifest.items || []).forEach((item, idx) => {
  const label = `items[${idx}]`;
  const required = ['id', 'image_file', 'url', 'sha256', 'width', 'height', 'label', 'topic_group', 'intent_key', 'scene_key'];
  required.forEach((field) => {
    if (item[field] === undefined || item[field] === null || item[field] === '') {
      errors.push(`${label}.${field} is required`);
    }
  });

  if (item.url && !String(item.url).startsWith('/sop-assets/')) {
    errors.push(`${label}.url must start with /sop-assets/`);
  }

  if (item.url) {
    if (urls.has(item.url)) {
      errors.push(`${label}.url duplicates ${urls.get(item.url)}`);
    }
    urls.set(item.url, label);
  }

  const ownerLabelKey = `${item.owner_scope || 'static'}::${item.label || ''}`;
  if (item.label) {
    if (ownerLabels.has(ownerLabelKey)) {
      warnings.push(`${label}.label duplicates ${ownerLabels.get(ownerLabelKey)} for ${ownerLabelKey}`);
    }
    ownerLabels.set(ownerLabelKey, label);
  }

  if (!item.image_file) return;
  const filePath = path.resolve(manifestDir, item.image_file);
  if (!fs.existsSync(filePath)) {
    errors.push(`${label}.image_file not found: ${item.image_file}`);
    return;
  }

  const actualHash = sha256(filePath);
  if (item.sha256 && actualHash !== item.sha256) {
    errors.push(`${label}.sha256 mismatch: expected ${item.sha256}, got ${actualHash}`);
  }

  const size = readImageSize(filePath);
  if (!size) {
    errors.push(`${label}.image_file has unsupported image format: ${item.image_file}`);
    return;
  }
  if (Number(item.width) !== size.width || Number(item.height) !== size.height) {
    errors.push(`${label}.size mismatch: expected ${item.width}x${item.height}, got ${size.width}x${size.height}`);
  }
});

warnings.forEach((warning) => console.warn(`[WARN] ${warning}`));

if (errors.length > 0) {
  errors.forEach((error) => console.error(`[ERROR] ${error}`));
  process.exit(1);
}

console.log(`[OK] SOP image manifest valid: ${manifest.asset_version || manifestPath} (${(manifest.items || []).length} images)`);
