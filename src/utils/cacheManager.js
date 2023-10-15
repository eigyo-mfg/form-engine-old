class CacheManager {
  constructor() {
    this.cache = new Map();
  }
  get(key) {
    return this.cache.get(key);
  }
  set(key, value) {
    this.cache.set(key, value);
  }
}

module.exports = new CacheManager();
