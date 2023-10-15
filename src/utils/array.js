const DEFAULT_CHUNK_SIZE = 5;

// 並列処理のためチャンクに分割する関数
function chunkArray(array, size = DEFAULT_CHUNK_SIZE) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

module.exports = {
  chunkArray,
};
