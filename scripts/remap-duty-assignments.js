import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { BSON } from "mongodb";

/**
 * Migration Script: Remap Duty Assignment Faculty IDs & EmployeeCodes from Prod Backup
 *
 * This script:
 * 1. Reads historical faculty data from backup/prod/HostelDuty/faculties.bson
 *    to map old _id -> employeeCode.
 * 2. Matches duty assignments to current faculties in DB using:
 *    - Old ID -> Backup employeeCode -> Current Faculty (100% exact match)
 *    - Normalized Name fallback (if backup record not found)
 * 3. Updates `faculty1.employeeCode`, `faculty1.id`, `faculty2.employeeCode`, and `faculty2.id`
 *    in the `dutyassignments` collection with new ObjectIds and permanent employee codes.
 * 4. Recalculates `lastDuty` and `lastWeekEndDuty` on the `Faculty` collection so future duty
 *    generation and fair rotation work accurately.
 *
 * Usage:
 *   DRY RUN (preview only, no DB changes):
 *     node --env-file=.env.local scripts/remap-duty-assignments.js
 *
 *   APPLY CHANGES:
 *     node --env-file=.env.local scripts/remap-duty-assignments.js --apply
 */

const DRY_RUN = !process.argv.includes("--apply");

function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/^(dr|prof|mr|mrs|ms|shri|smt|er)\.?\s+/i, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readBsonFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const buffer = fs.readFileSync(filePath);
    let offset = 0;
    const docs = [];
    while (offset < buffer.length) {
      const size = buffer.readInt32LE(offset);
      docs.push(BSON.deserialize(buffer.subarray(offset, offset + size)));
      offset += size;
    }
    return docs;
  } catch (err) {
    console.warn(`Could not read BSON file at ${filePath}:`, err.message);
    return [];
  }
}

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ Error: MONGO_URI is not defined in .env.local");
    process.exit(1);
  }

  console.log("==================================================");
  console.log(`🚀 Starting Duty Remapping Script (${DRY_RUN ? "DRY RUN MODE" : "APPLY MODE"})`);
  console.log("==================================================");

  await mongoose.connect(uri);
  console.log(" Connected to MongoDB:", mongoose.connection.name);

  const Faculty =
    mongoose.models.Faculty ||
    mongoose.model("Faculty", new mongoose.Schema({}, { strict: false }));
  const DutyAssignment =
    mongoose.models.DutyAssignment ||
    mongoose.model(
      "DutyAssignment",
      new mongoose.Schema({}, { strict: false })
    );

  // 1. Load current faculties from DB
  const currentFaculties = await Faculty.find({}).lean();
  console.log(` Loaded ${currentFaculties.length} current faculty members from DB.`);

  const codeToFaculty = new Map();
  const currentIdToFaculty = new Map();
  const nameToFacultyList = new Map();

  for (const f of currentFaculties) {
    const fIdStr = String(f._id);
    currentIdToFaculty.set(fIdStr, f);

    if (f.employeeCode) {
      codeToFaculty.set(String(f.employeeCode).trim(), f);
    }

    const norm = normalizeName(f.name);
    if (norm) {
      if (!nameToFacultyList.has(norm)) nameToFacultyList.set(norm, []);
      nameToFacultyList.get(norm).push(f);
    }

    const fullNameNorm = normalizeName((f.title ? f.title + " " : "") + f.name);
    if (fullNameNorm && fullNameNorm !== norm) {
      if (!nameToFacultyList.has(fullNameNorm))
        nameToFacultyList.set(fullNameNorm, []);
      nameToFacultyList.get(fullNameNorm).push(f);
    }
  }

  // 2. Load backup mappings (oldId -> employeeCode) - defaulting to backup/prod
  const oldIdToCode = new Map();

  const backupArg = process.argv.find((a) => a.startsWith("--backup="));
  const customBackupPath = backupArg ? backupArg.split("=")[1] : null;

  const backupCandidates = customBackupPath
    ? [
        path.isAbsolute(customBackupPath)
          ? customBackupPath
          : path.join(process.cwd(), customBackupPath),
      ]
    : [
        path.join(process.cwd(), "backup/prod/HostelDuty/faculties.bson"),
        path.join(process.cwd(), "backup/local/DemoHostelDuty/faculties.bson"),
      ];

  const loadedBackupFiles = [];
  for (const bp of backupCandidates) {
    const backupDocs = readBsonFile(bp);
    if (backupDocs.length > 0) {
      loadedBackupFiles.push(`${bp} (${backupDocs.length} records)`);
      for (const doc of backupDocs) {
        if (doc._id && doc.employeeCode) {
          const idKey = String(doc._id);
          if (!oldIdToCode.has(idKey)) {
            oldIdToCode.set(idKey, String(doc.employeeCode).trim());
          }
        }
      }
    }
  }

  console.log(` Loaded backup source(s):`);
  loadedBackupFiles.forEach((f) => console.log(`   - ${f}`));
  console.log(` Extracted ${oldIdToCode.size} unique faculty ID mappings.\n`);

  // 3. Process duty assignments
  const dutyDocs = await DutyAssignment.find({}).sort({ date: 1 }).lean();
  console.log(` Loaded ${dutyDocs.length} duty assignment records.\n`);

  let updatedDutiesCount = 0;
  let unchangedDutiesCount = 0;
  let f1Updated = 0;
  let f2Updated = 0;
  let f1Unresolved = 0;
  let f2Unresolved = 0;

  const dutyBulkOps = [];
  const facultyHistoryMap = new Map();

  function recordFacultyDutyHistory(facultyDoc, dutyDoc) {
    const fId = String(facultyDoc._id);
    const dutyDate = new Date(dutyDoc.date);
    const isWeekend = dutyDate.getDay() === 0 || dutyDate.getDay() === 6;

    const totalRooms =
      dutyDoc.endRoom && dutyDoc.startRoom
        ? dutyDoc.endRoom - dutyDoc.startRoom + 1
        : 6;

    const entry = facultyHistoryMap.get(fId) || {
      lastDuty: null,
      lastWeekEndDuty: null,
    };

    if (!entry.lastDuty || new Date(entry.lastDuty.date) <= dutyDate) {
      entry.lastDuty = {
        date: dutyDate,
        hostel: dutyDoc.hostel,
        roomAlloted: dutyDoc.roomRange || `${dutyDoc.startRoom}-${dutyDoc.endRoom}`,
        numberOfRooms: totalRooms,
      };
    }

    if (isWeekend) {
      if (!entry.lastWeekEndDuty || new Date(entry.lastWeekEndDuty.date) <= dutyDate) {
        entry.lastWeekEndDuty = { date: dutyDate };
      }
    }

    facultyHistoryMap.set(fId, entry);
  }

  function resolveFaculty(facultyObj) {
    if (!facultyObj || (!facultyObj.id && !facultyObj.employeeCode && !facultyObj.name)) {
      return { status: "empty" };
    }

    // 1. If employeeCode is already present and matches
    if (facultyObj.employeeCode && codeToFaculty.has(String(facultyObj.employeeCode).trim())) {
      return { status: "matched_by_code", faculty: codeToFaculty.get(String(facultyObj.employeeCode).trim()) };
    }

    const oldIdStr = facultyObj.id ? String(facultyObj.id) : "";

    // 2. If it already matches a current faculty _id
    if (oldIdStr && currentIdToFaculty.has(oldIdStr)) {
      return { status: "already_current", faculty: currentIdToFaculty.get(oldIdStr) };
    }

    // 3. Match via backup employeeCode
    if (oldIdStr && oldIdToCode.has(oldIdStr)) {
      const code = oldIdToCode.get(oldIdStr);
      if (code && codeToFaculty.has(code)) {
        return { status: "matched_by_backup_code", faculty: codeToFaculty.get(code) };
      }
    }

    // 4. Match via normalized name
    const normName = normalizeName(facultyObj.name);
    const matches = nameToFacultyList.get(normName);
    if (matches && matches.length === 1) {
      return { status: "matched_by_name", faculty: matches[0] };
    } else if (matches && matches.length > 1) {
      const groupMatch = matches.filter(
        (m) =>
          m.employeeGroup &&
          facultyObj.employeeGroup &&
          m.employeeGroup.toLowerCase() === facultyObj.employeeGroup.toLowerCase()
      );
      if (groupMatch.length === 1) {
        return { status: "matched_by_name_group", faculty: groupMatch[0] };
      }
    }

    return { status: "unresolved", faculty: null };
  }

  for (const doc of dutyDocs) {
    let docModified = false;
    const updateSet = {};

    // Check Faculty 1
    if (doc.faculty1 && (doc.faculty1.id || doc.faculty1.name || doc.faculty1.employeeCode)) {
      const res = resolveFaculty(doc.faculty1);
      if (res.faculty) {
        const newFaculty = res.faculty;
        const currentF1Id = doc.faculty1.id ? String(doc.faculty1.id) : "";
        const newF1Id = String(newFaculty._id);
        const currentF1Code = doc.faculty1.employeeCode || "";
        const newF1Code = newFaculty.employeeCode || "";

        if (currentF1Id !== newF1Id || currentF1Code !== newF1Code) {
          updateSet["faculty1.id"] = newFaculty._id;
          updateSet["faculty1.employeeCode"] = newF1Code;
          updateSet["faculty1.name"] = newFaculty.name;
          if (newFaculty.employeeGroup) {
            updateSet["faculty1.employeeGroup"] = newFaculty.employeeGroup;
          }
          docModified = true;
          f1Updated++;
        }
        recordFacultyDutyHistory(newFaculty, doc);
      } else {
        f1Unresolved++;
      }
    }

    // Check Faculty 2
    if (doc.faculty2 && (doc.faculty2.id || doc.faculty2.name || doc.faculty2.employeeCode)) {
      const res = resolveFaculty(doc.faculty2);
      if (res.faculty) {
        const newFaculty = res.faculty;
        const currentF2Id = doc.faculty2.id ? String(doc.faculty2.id) : "";
        const newF2Id = String(newFaculty._id);
        const currentF2Code = doc.faculty2.employeeCode || "";
        const newF2Code = newFaculty.employeeCode || "";

        if (currentF2Id !== newF2Id || currentF2Code !== newF2Code) {
          updateSet["faculty2.id"] = newFaculty._id;
          updateSet["faculty2.employeeCode"] = newF2Code;
          updateSet["faculty2.name"] = newFaculty.name;
          if (newFaculty.employeeGroup) {
            updateSet["faculty2.employeeGroup"] = newFaculty.employeeGroup;
          }
          docModified = true;
          f2Updated++;
        }
        recordFacultyDutyHistory(newFaculty, doc);
      } else {
        f2Unresolved++;
      }
    }

    if (docModified) {
      updatedDutiesCount++;
      dutyBulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: updateSet },
        },
      });
    } else {
      unchangedDutiesCount++;
    }
  }

  console.log("📊 --- SUMMARY OF DUTY REMAPPING ---");
  console.log(`Total Duty Assignments: ${dutyDocs.length}`);
  console.log(`Duties to be updated with new IDs & EmpCodes: ${updatedDutiesCount}`);
  console.log(`Duties already up to date: ${unchangedDutiesCount}`);
  console.log(`Faculty 1 slots remapped: ${f1Updated}`);
  console.log(`Faculty 2 slots remapped: ${f2Updated}`);
  console.log(`Historical/deleted faculty slots (not in current list): F1=${f1Unresolved}, F2=${f2Unresolved}`);
  console.log(`Active faculty members with synced duty history: ${facultyHistoryMap.size}\n`);

  if (!DRY_RUN) {
    if (dutyBulkOps.length > 0) {
      console.log(`💾 Writing ${dutyBulkOps.length} updates to DutyAssignment collection...`);
      await DutyAssignment.bulkWrite(dutyBulkOps);
      console.log("✅ DutyAssignment records successfully remapped with employeeCodes and new IDs.");
    }

    if (facultyHistoryMap.size > 0) {
      console.log(`💾 Updating lastDuty & lastWeekEndDuty on ${facultyHistoryMap.size} Faculty records...`);
      const facultyBulkOps = [];
      for (const [fId, history] of facultyHistoryMap.entries()) {
        const update = {};
        if (history.lastDuty) update.lastDuty = history.lastDuty;
        if (history.lastWeekEndDuty) update.lastWeekEndDuty = history.lastWeekEndDuty;
        facultyBulkOps.push({
          updateOne: {
            filter: { _id: fId },
            update: { $set: update },
          },
        });
      }
      await Faculty.bulkWrite(facultyBulkOps);
      console.log("✅ Faculty lastDuty & lastWeekEndDuty successfully updated.");
    }

    console.log("\n🎉 MIGRATION COMPLETE! Everything is remapped and synced.");
  } else {
    console.log("ℹ️ DRY RUN COMPLETE. No changes were saved to the database.");
    console.log("To apply these changes, run:");
    console.log("  node --env-file=.env.local scripts/remap-duty-assignments.js --apply\n");
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Fatal error during migration:", err);
  process.exit(1);
});
