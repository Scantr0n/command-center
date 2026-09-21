const fs = require('fs');
const path = require('path');
// Deliberately NOT `require('googleapis')`, that barrel package eagerly
// loads every Google API it ships (~250 of them) just to get Drive, which
// measured 2+ minutes to require on this machine. Requiring only the Drive
// API module and the shared OAuth2Client keeps startup fast.
const { OAuth2Client } = require('googleapis-common');
const { drive: driveApi } = require('googleapis/build/src/apis/drive');

const ORIGINAL_CREDENTIALS_PATH = path.join(__dirname, 'drive_client_secret.json');
const TOKEN_PATH = path.join(__dirname, 'drive_token.json');
const FOLDER_NAME = 'ClaudeCommandCenter';

// gaxios (the HTTP client under googleapis) only applies a timeout when the
// caller explicitly passes one, there's no default, and every other outbound
// call in this codebase already gives itself one (server.js's chat, Garage
// drafter, and Alpha proxy calls) except this file, which had none anywhere.
// A stall here (a flaky wifi/VPN transition, a captive portal, a mid-request
// drop, not an outright failure) previously hung readClusters() forever,
// which backs the single most load-bearing endpoint in the app
// (/api/clusters, polled every 30s from every hub page's sidebar plus the
// main dashboard) since the try/catch around it only helps on a real reject,
// not a hang. Metadata-only calls (folder lookup, listing/reading/writing a
// small JSON snapshot) should always be fast, so a stall past 15s is treated
// as a real failure. uploadFile's two media-carrying calls are excluded from
// this constant: its own comment above documents it as handling "large media
// transfers", so a short metadata timeout would wrongly kill a legitimate
// slow upload over a real home connection.
const DRIVE_METADATA_TIMEOUT_MS = 15000;

let cachedFolderId = null;

function getAuthClient() {
  const clientSecret = JSON.parse(fs.readFileSync(ORIGINAL_CREDENTIALS_PATH, 'utf8')).installed;
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const client = new OAuth2Client(clientSecret.client_id, clientSecret.client_secret, clientSecret.redirect_uris[0]);
  client.setCredentials({
    refresh_token: token.refresh_token,
    access_token: token.token,
  });
  return client;
}

async function getDrive() {
  const auth = getAuthClient();
  return driveApi({ version: 'v3', auth });
}

async function getFolderId(drive) {
  if (cachedFolderId) return cachedFolderId;
  const res = await drive.files.list({
    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
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
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });

  const media = { mimeType: 'application/json', body: content };

  if (existing.data.files.length) {
    await drive.files.update({ fileId: existing.data.files[0].id, media }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  } else {
    await drive.files.create({
      resource: { name: filename, parents: [folderId] },
      media,
      fields: 'id',
    }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  }
}

async function readSnapshot(clusterId) {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);
  const filename = `${clusterId}.json`;
  const existing = await drive.files.list({
    q: `name='${filename}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name)',
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  if (!existing.data.files.length) return null;
  const res = await drive.files.get({ fileId: existing.data.files[0].id, alt: 'media' }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  return res.data;
}

async function listSnapshots() {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, modifiedTime)',
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  return res.data.files;
}

// Finds or creates a subfolder by name under a given parent (defaults to the
// ClaudeCommandCenter root). Used for organizing large media transfers.
async function getOrCreateSubfolder(name, parentId) {
  const drive = await getDrive();
  const parent = parentId || await getFolderId(drive);
  const existing = await drive.files.list({
    q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`,
    fields: 'files(id, name)',
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  if (existing.data.files.length) return existing.data.files[0].id;
  const created = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
    fields: 'id',
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });
  return created.data.id;
}

// Uploads a local file into a given Drive folder (creates or overwrites by name).
// The read stream's own 'error' event is raced against the upload promise so a
// mid-transfer network blip rejects cleanly instead of crashing the process.
async function uploadFile(localPath, folderId, remoteName) {
  const drive = await getDrive();
  const name = remoteName || path.basename(localPath);
  const existing = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, name)',
  }, { timeout: DRIVE_METADATA_TIMEOUT_MS });

  const stream = fs.createReadStream(localPath);
  const streamError = new Promise((_, reject) => {
    stream.on('error', reject);
  });
  const media = { body: stream };

  // No timeout on these two calls: unlike every metadata-only call above,
  // this one actually carries the file body (this function's own comment
  // documents it as handling "large media transfers"), so the short
  // metadata timeout would wrongly kill a legitimate slow upload over a
  // real home connection. The streamError race above still bounds it against
  // a read-side failure, just not a network-side stall.
  const uploadCall = existing.data.files.length
    ? drive.files.update({ fileId: existing.data.files[0].id, media }).then(() => existing.data.files[0].id)
    : drive.files.create({ resource: { name, parents: [folderId] }, media, fields: 'id' }).then(r => r.data.id);

  return Promise.race([uploadCall, streamError]);
}

module.exports = { writeSnapshot, readSnapshot, listSnapshots, getFolderId, getDrive, getOrCreateSubfolder, uploadFile };
