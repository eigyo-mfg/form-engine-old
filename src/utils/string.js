function extractJson(str) {
    const startIdx = str.indexOf('{');
    const endIdx = str.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
        const jsonString = str.slice(startIdx, endIdx + 1);
        // コメントを削除（//から始まる行を削除）
        const jsonWithoutComments = jsonString.replace(/\/\/.*$/gm, '');
        try {
            return JSON.parse(jsonWithoutComments);
        } catch (e) {
            console.error(`Failed to parse JSON: ${e}`);
        }
    }
    return null;
}

module.exports = {
    extractJson,
}