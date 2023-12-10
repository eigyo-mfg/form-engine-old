const {google} = require('googleapis');
const keys = require('../../serviceAccountKey.json'); // OAuth2クライアントのJSONファイルを読み込む

const jwtClient = new google.auth.JWT(
    keys.client_email,
    null,
    keys.private_key,
    ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
);

const gsapi = google.sheets({version: 'v4', auth: jwtClient});
const drive = google.drive({version: 'v3', auth: jwtClient});

module.exports = {
    gsapi,
    drive,
}