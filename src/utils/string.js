function extractJson(str) {
    const startIdx = str.indexOf('{');
    const endIdx = str.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
        const jsonString = str.slice(startIdx, endIdx + 1);
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            console.error(`Failed to parse JSON: ${e}`);
        }
    }
    return null;
}

module.exports = {
    extractJson,
}