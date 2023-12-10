const fs = require('fs');
const path = require('path');
const {drive} = require("./google");
async function uploadImage(filePath) {
    const response = await drive.files.create({
        requestBody: {
            name: path.basename(filePath),
            mimeType: 'image/png',
            parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
        },
        media: {
            mimeType: 'image/png',
            body: fs.createReadStream(filePath)
        },
        fields: 'id'
    });
    return response.data;
}

async function getImageUrl(fileId) {
    const response = await drive.files.get({
        fileId: fileId,
        fields: 'webViewLink'
    });
    return response.data.webViewLink;
}

module.exports = {
    uploadImage,
    getImageUrl
}