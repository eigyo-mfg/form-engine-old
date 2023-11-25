const crypto = require('crypto');

/**
 * ハッシュ化
 * @param value
 * @return {string}
 */
function hash(value) {
  const hash = crypto.createHash('sha256');
  hash.update(value);
  return hash.digest('hex');
}

module.exports = {
  hash,
};
