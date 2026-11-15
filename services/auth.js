/**
 * C9Z Web v2.0 — Hardened Developer Authentication Service
 * --------------------------------------------------------
 * Features:
 * - Password verification using Node crypto.scryptSync + timingSafeEqual
 * - Signed stateless HMAC-SHA256 session tokens stored in HttpOnly, SameSite=Strict cookies
 * - Brute-force rate limiting per IP on login attempts
 */

const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'c9z_admin_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEV_GATE_COOKIE_NAME = 'c9z_dev_gate';
const DEV_GATE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Brute-force login protection
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getSessionSecret() {
  return process.env.SESSION_SECRET || 'c9z_fallback_local_hmac_secret_change_me_2026';
}

function getExpectedUsername() {
  return (process.env.ADMIN_USERNAME || 'c9zadmin').trim();
}

function getExpectedDevKey() {
  return (process.env.DEV_ACCESS_KEY || 'C9Z-DEV-2026').trim();
}

// Compute or retrieve scrypt salt:hash
let cachedSalt = null;
let cachedHash = null;
let usingDefaultDevPassword = false;

function initCredentials() {
  const envHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();
  if (envHash && envHash.includes(':')) {
    const [saltHex, keyHex] = envHash.split(':');
    cachedSalt = Buffer.from(saltHex, 'hex');
    cachedHash = Buffer.from(keyHex, 'hex');
    usingDefaultDevPassword = false;
    return;
  }
  const plainPassword = (process.env.ADMIN_PASSWORD || 'C9Z@Admin2026').trim();
  usingDefaultDevPassword = plainPassword === 'C9Z@Admin2026';
  cachedSalt = crypto.createHash('sha256').update('c9z_static_local_salt').digest().subarray(0, 16);
  cachedHash = crypto.scryptSync(plainPassword, cachedSalt, 64);
}

initCredentials();

function verifyCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') return false;
  const expectedUser = getExpectedUsername();
  const userBuf = Buffer.from(username.trim());
  const expUserBuf = Buffer.from(expectedUser);

  const userMatch =
    userBuf.length === expUserBuf.length && crypto.timingSafeEqual(userBuf, expUserBuf);

  const candidateHash = crypto.scryptSync(password, cachedSalt, 64);
  const passMatch =
    candidateHash.length === cachedHash.length &&
    crypto.timingSafeEqual(candidateHash, cachedHash);

  return userMatch && passMatch;
}

function createSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      role: 'admin',
      exp: Date.now() + SESSION_TTL_MS,
      nonce: crypto.randomBytes(8).toString('hex')
    })
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function verifyDevAccessKey(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return false;
  const candidateHash = crypto.createHash('sha256').update(candidate.trim()).digest();
  const expectedHash = crypto.createHash('sha256').update(getExpectedDevKey()).digest();
  return candidateHash.length === expectedHash.length && crypto.timingSafeEqual(candidateHash, expectedHash);
}

function createDevGateToken() {
  const payload = Buffer.from(
    JSON.stringify({
      scope: 'dev_gate',
      iat: Date.now(),
      exp: Date.now() + DEV_GATE_TTL_MS,
      jti: crypto.randomBytes(8).toString('hex')
    })
  ).toString('base64url');

  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest('base64url');

  return `${payload}.${sig}`;
}

function verifyDevGateToken(token) {
  const data = verifySessionToken(token);
  if (!data || data.scope !== 'dev_gate') return null;
  return data;
}

function hasDeveloperGateAccess(req) {
  const cookies = parseCookies(req.headers?.cookie);
  if (verifyDevGateToken(cookies[DEV_GATE_COOKIE_NAME])) return true;
  if (verifySessionToken(cookies[SESSION_COOKIE_NAME])) return true;
  return false;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec) return { allowed: true };
  if (now > rec.resetAt) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  if (rec.count >= MAX_LOGIN_ATTEMPTS) {
    const waitSec = Math.ceil((rec.resetAt - now) / 1000);
    return { allowed: false, waitSec };
  }
  return { allowed: true };
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_LOCKOUT_MS };
  rec.count += 1;
  loginAttempts.set(ip, rec);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'غير مصرح بالوصول. يرجى تسجيل الدخول إلى لوحة المطور أولاً.'
    });
  }
  req.admin = session;
  next();
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  DEV_GATE_COOKIE_NAME,
  DEV_GATE_TTL_MS,
  verifyCredentials,
  createSessionToken,
  verifySessionToken,
  verifyDevAccessKey,
  createDevGateToken,
  verifyDevGateToken,
  hasDeveloperGateAccess,
  parseCookies,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  requireAdmin,
  isUsingDefaultDevPassword: () => usingDefaultDevPassword
};
