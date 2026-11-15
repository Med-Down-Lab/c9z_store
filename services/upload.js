/**
 * C9Z Web v2.0 — Secure Image Upload Validator (Magic-Byte Inspection)
 * --------------------------------------------------------------------
 * Protects the Developer Dashboard image upload endpoint against:
 * - Malicious executable uploads disguised with image extensions (.php.jpg, .exe, .svg XSS)
 * - Path traversal attacks
 * - Oversized payload DoS
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB max

function detectImageTypeByMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

function saveBase64ProductImage(dataUrl, imagesDir) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('صيغة البيانات المرفوعة غير صالحة.');
  }

  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('بيانات الصورة غير مكتملة.');
  }

  const base64Part = dataUrl.slice(commaIdx + 1);
  const buffer = Buffer.from(base64Part, 'base64');

  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('حجم الصورة يتجاوز الحد المسموح (4 ميجابايت كحد أقصى).');
  }

  const ext = detectImageTypeByMagicBytes(buffer);
  if (!ext) {
    throw new Error('نوع الملف المرفوع غير مدعوم أمنياً. يُسمح فقط بملفات JPG و PNG و WebP الحقيقية.');
  }

  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const safeName = `c9z-prod-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const fullPath = path.join(imagesDir, safeName);

  fs.writeFileSync(fullPath, buffer);
  return `/images/${safeName}`;
}

module.exports = {
  detectImageTypeByMagicBytes,
  saveBase64ProductImage
};
