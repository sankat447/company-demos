/**
 * Paytm checksum (signature) — AES-128-CBC over a salted SHA-256, the scheme
 * Paytm's PaytmChecksum library uses. Shared by create-order (sign the Initiate
 * Transaction request) and payment-webhook (verify the callback). The merchant
 * key is the AES key and NEVER leaves the backend.
 */
'use strict';
const crypto = require('node:crypto');

const IV = '@@@@&&&&####$$$$';

function encrypt(input, key) {
  const cipher = crypto.createCipheriv('AES-128-CBC', key, IV);
  return cipher.update(input, 'binary', 'base64') + cipher.final('base64');
}

function decrypt(encrypted, key) {
  const decipher = crypto.createDecipheriv('AES-128-CBC', key, IV);
  return decipher.update(encrypted, 'base64', 'binary') + decipher.final('binary');
}

function salt(len) {
  return crypto.randomBytes(len).toString('base64').slice(0, len);
}

/** Sign a params string (for the JSON body: pass JSON.stringify(body)). */
function generateSignature(params, key) {
  const s = salt(4);
  const hash = crypto.createHash('sha256').update(`${params}|${s}`).digest('hex') + s;
  return encrypt(hash, key);
}

/** Verify a checksum against a params string. */
function verifySignature(params, key, checksum) {
  if (!checksum) return false;
  let decrypted;
  try {
    decrypted = decrypt(checksum, key);
  } catch {
    return false;
  }
  const s = decrypted.slice(-4);
  const expected = crypto.createHash('sha256').update(`${params}|${s}`).digest('hex') + s;
  return expected === decrypted;
}

/**
 * Paytm's canonical param string for a form/callback payload: values of all
 * keys except CHECKSUMHASH, ordered by key, joined by '|'. Used to verify the
 * server-to-server callback.
 */
function paramsToString(obj) {
  return Object.keys(obj)
    .filter((k) => k !== 'CHECKSUMHASH' && k !== 'checksumhash')
    .sort()
    .map((k) => (obj[k] === null || obj[k] === undefined ? '' : String(obj[k])))
    .join('|');
}

module.exports = { generateSignature, verifySignature, paramsToString };
