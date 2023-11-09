function extractJson(str) {
    const regex = /{.*?}/;
    const match = str.match(regex);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch (e) {
            console.error(`Failed to parse JSON: ${e}`);
        }
    }
    return null;
}

module.exports = {
    extractJson,
}