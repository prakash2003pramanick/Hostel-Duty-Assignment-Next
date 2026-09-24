import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Script to take a full MongoDB backup using mongodump.
 *
 * Usage:
 *   npm run backup-db
 *   node --env-file=.env.local scripts/backup-db.js
 *   node --env-file=.env.local scripts/backup-db.js --name my-custom-backup
 */

function getArgumentValue(argName, defaultValue) {
  const idx = process.argv.indexOf(argName);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("❌ Error: MONGO_URI not found in environment (.env.local).");
  process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const customName = getArgumentValue("--name", timestamp);
const backupDir = path.resolve(process.cwd(), "backup", customName);

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

console.log("==================================================");
console.log("📦 Starting MongoDB Database Backup");
console.log("==================================================");
console.log(`📁 Target directory: ${backupDir}`);

try {
  console.log("⏳ Running mongodump...");
  execSync(`mongodump --uri="${uri}" --out="${backupDir}"`, {
    stdio: "inherit",
  });

  console.log("\n✅ Database backup completed successfully!");
  console.log(`📂 Location: ${backupDir}`);
  console.log("\n💡 To restore this backup later, run:");
  console.log(`  mongorestore --uri="${uri}" "${backupDir}"\n`);
} catch (error) {
  console.error("❌ Backup failed:", error.message);
  process.exit(1);
}
