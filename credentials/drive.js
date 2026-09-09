const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const ORIGINAL_CREDENTIALS_PATH = path.join(__dirname, 'drive_client_secret.json');
const TOKEN_PATH = path.join(__dirname, 'drive_token.json');
const FOLDER_NAME = 'ClaudeCommandCenter';

let cachedFolderId = null;

function getAuthClient() {
  const clientSecret = JSON.parse(fs.readFileSync(ORIGINAL_CREDENTIALS_PATH, 'utf8')).installed;
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const client = new google.auth.OAuth2(clientSecret.client_id, clientSecret.client_secret, clientSecret.redirect_uris[0]);
  client.setCredentials({
    refresh_token: token.refresh_token,
    access_token: token.token,
  });
  return client;
}

async function getDrive() {
  const auth = getAuthClient();
  return google.drive({ version: 'v3', auth });
}

async function getFolderId(drive) {
  if (cachedFolderId) return cachedFolderId;
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  if (!res.data.files.length) throw new Error(`Folder "${FOLDER_NAME}" not found in Drive`);
  cachedFolderId = res.data.files[0].id;
  return cachedFolderId;
}

async function writeSnapshot(clusterId, data) {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);
  const filename = `${clusterId}.json`;
  const content = JSON.stringify(data, null, 2);

  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name)',
  });

  const media = { mimeType: 'application/json', body: content };

  if (existing.data.files.length) {
    await drive.files.update({ fileId: existing.data.files[0].id, media });
  } else {
    await drive.files.create({
      resource: { name: filename, parents: [folderId] },
      media,
      fields: 'id',
    });
  }
}

async function readSnapshot(clusterId) {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);
  const filename = `${clusterId}.json`;
  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name)',
  });
  if (!existing.data.files.length) return null;
  const res = await drive.files.get({ fileId: existing.data.files[0].id, alt: 'media' });
  return res.data;
}

async function listSnapshots() {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, modifiedTime)',
  });
  return res.data.files;
}

module.exports = { writeSnapshot, readSnapshot, listSnapshots, getFolderId, getDrive };
