// CLI wrapper so scheduled tasks can write a Command Center snapshot via Bash.
// Usage: node write_snapshot.js <clusterId> '<json string>'
const { writeSnapshot } = require('./drive.js');

const [, , clusterId, jsonStr] = process.argv;

if (!clusterId || !jsonStr) {
  console.error('Usage: node write_snapshot.js <clusterId> \'<json>\'');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(jsonStr);
} catch (e) {
  console.error('Invalid JSON:', e.message);
  process.exit(1);
}

writeSnapshot(clusterId, data)
  .then(() => {
    console.log(`Snapshot written for "${clusterId}"`);
  })
  .catch(err => {
    console.error('Failed to write snapshot:', err.message);
    process.exit(1);
  });
