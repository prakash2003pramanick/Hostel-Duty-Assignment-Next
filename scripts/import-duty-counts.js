import fs from "fs";
import path from "path";
import { createRequire } from "module";
import mongoose from "mongoose";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

/**
 * Script: Import & Increment Faculty Duty Counts from Excel
 *
 * This script:
 * 1. Connects to MongoDB using MONGO_URI from environment.
 * 2. Initializes count records for all existing faculties in DB with default 0s
 *    (weekdaysCount: 0, weekendCount: 0, total: 0).
 * 3. Reads the duty count summary Excel file (e.g., 'Duty Count Summary Male Aug.xlsx').
 * 4. Increments the duty counters (weekdaysCount, weekendCount, total) for each employee.
 *
 * Usage:
 *   DRY RUN (preview only, no DB changes):
 *     node --env-file=.env.local scripts/import-duty-counts.js
 *
 *   APPLY CHANGES:
 *     node --env-file=.env.local scripts/import-duty-counts.js --apply
 *
 *   SPECIFY CUSTOM FILE:
 *     node --env-file=.env.local scripts/import-duty-counts.js --file "./path/to/file.xlsx" --apply
 */

const APPLY_CHANGES = process.argv.includes("--apply");
const DRY_RUN = !APPLY_CHANGES;

function getArgumentValue(argName, defaultValue) {
  const idx = process.argv.indexOf(argName);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

const customFilePath = getArgumentValue(
  "--file",
  "./Female duty Count Summary Sept.xlsx"
);
const excelFilePath = path.resolve(process.cwd(), customFilePath);

async function run() {
  console.log("==================================================");
  console.log(
    `🚀 Duty Count Import & Increment Script (${
      DRY_RUN ? "DRY RUN MODE" : "APPLY MODE"
    })`
  );
  console.log("==================================================");

  if (!fs.existsSync(excelFilePath)) {
    console.error(`❌ Excel file not found at: ${excelFilePath}`);
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(
      "❌ MONGO_URI not found in environment. Please supply via --env-file=.env.local"
    );
    process.exit(1);
  }

  console.log(`📖 Reading Excel file: ${excelFilePath}`);
  const workbook = XLSX.readFile(excelFilePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);

  console.log(
    ` Found sheet "${sheetName}" with ${rows.length} record rows.`
  );

  console.log(" Connecting to MongoDB...");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(` Connected to MongoDB: ${mongoose.connection.name}`);

  // Fetch all existing faculties to ensure baseline counts exist
  const facultyCollection = db.collection("faculties");
  const countCollection = db.collection("counts");

  const faculties = await facultyCollection.find({}).toArray();
  console.log(` Loaded ${faculties.length} faculty members from database.`);

  const facultyByCode = new Map();
  for (const f of faculties) {
    const code = String(f.employeeCode ?? "").trim();
    if (code) {
      facultyByCode.set(code, f);
    }
  }

  // Step 1: Ensure all existing faculties have a baseline count record (defaults: 0)
  console.log("\n--- STEP 1: Baseline Initialization (Default 0 for all) ---");
  const baselineOps = [];
  for (const [code] of facultyByCode.entries()) {
    baselineOps.push({
      updateOne: {
        filter: { empId: code },
        update: {
          $setOnInsert: {
            empId: code,
            weekdaysCount: 0,
            weekendCount: 0,
            total: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  if (baselineOps.length > 0) {
    if (!DRY_RUN) {
      const initResult = await countCollection.bulkWrite(baselineOps, {
        ordered: false,
      });
      console.log(
        ` Baseline ensured. Inserted new count docs: ${initResult.upsertedCount}, Matched existing: ${initResult.matchedCount}`
      );
    } else {
      console.log(
        ` [DRY RUN] Would ensure baseline count records (0 defaults) for ${baselineOps.length} faculties.`
      );
    }
  }

  // Step 2: Parse and prepare increments from Excel
  console.log("\n--- STEP 2: Processing Excel Records & Increments ---");
  let validExcelRecords = 0;
  let skippedRows = 0;
  let notFoundInFacultyDb = [];
  let totalWeekdayInc = 0;
  let totalWeekendInc = 0;
  let totalInc = 0;

  const incrementOps = [];
  const previewList = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Support common column variations
    const empCodeRaw =
      row["Employee Code"] ??
      row["employeeCode"] ??
      row["Emp. Code"] ??
      row["EmpCode"] ??
      row["empCode"] ??
      row["Emp Code"];

    const teacherName =
      row["Teacher Name"] ??
      row["Name"] ??
      row["Faculty Name"] ??
      "";

    const weekdayDuties = Number(
      row["Weekday Duties"] ?? row["Weekday"] ?? row["weekdaysCount"] ?? 0
    ) || 0;

    const weekendDuties = Number(
      row["Weekend Duties"] ?? row["Weekend"] ?? row["weekendCount"] ?? 0
    ) || 0;

    const totalDuties = Number(
      row["Total Duties"] ?? row["Total"] ?? (weekdayDuties + weekendDuties)
    ) || (weekdayDuties + weekendDuties);

    const empCode = String(empCodeRaw ?? "").trim();

    if (!empCode) {
      skippedRows++;
      continue;
    }

    validExcelRecords++;
    totalWeekdayInc += weekdayDuties;
    totalWeekendInc += weekendDuties;
    totalInc += totalDuties;

    const matchedFaculty = facultyByCode.get(empCode);
    if (!matchedFaculty) {
      notFoundInFacultyDb.push({
        empCode,
        name: teacherName,
        rowNumber: i + 2,
      });
    }

    if (previewList.length < 5) {
      previewList.push({
        empId: empCode,
        name: teacherName || matchedFaculty?.name || "N/A",
        weekdayDuties,
        weekendDuties,
        totalDuties,
      });
    }

    incrementOps.push({
      updateOne: {
        filter: { empId: empCode },
        update: {
          $inc: {
            weekdaysCount: weekdayDuties,
            weekendCount: weekendDuties,
            total: totalDuties,
          },
          $set: {
            updatedAt: new Date(),
          },
          $setOnInsert: {
            empId: empCode,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  console.log(`\nSample increments (first ${previewList.length} rows):`);
  console.table(previewList);

  console.log("\n📊 --- SUMMARY OF IMPORT & INCREMENT ---");
  console.log(`Total Excel rows:                ${rows.length}`);
  console.log(`Valid records to increment:      ${validExcelRecords}`);
  console.log(`Skipped rows (empty emp code):   ${skippedRows}`);
  console.log(`Matched with Faculty collection: ${validExcelRecords - notFoundInFacultyDb.length}`);
  console.log(`Excel codes not in Faculty DB:   ${notFoundInFacultyDb.length}`);
  console.log(`Total Weekday duties to add:     ${totalWeekdayInc}`);
  console.log(`Total Weekend duties to add:     ${totalWeekendInc}`);
  console.log(`Total duties to add:             ${totalInc}`);

  if (notFoundInFacultyDb.length > 0) {
    console.log(
      `\n⚠️ Note: The following ${notFoundInFacultyDb.length} employee codes from Excel are not in the faculties collection (a Count record will still be created for them):`
    );
    console.log(notFoundInFacultyDb);
  }

  // Step 3: Apply increments if requested
  if (!DRY_RUN) {
    console.log("\n Applying updates to database...");
    const incResult = await countCollection.bulkWrite(incrementOps, {
      ordered: false,
    });
    console.log(
      `✅ Success! Updated: ${incResult.modifiedCount} records, Upserted: ${incResult.upsertedCount} records.`
    );

    // Verify sample from database
    const sampleDbCounts = await countCollection.find({}).limit(5).toArray();
    console.log("\n🔍 Verification - Sample 5 Count documents in DB:");
    console.table(
      sampleDbCounts.map((doc) => ({
        empId: doc.empId,
        weekdaysCount: doc.weekdaysCount,
        weekendCount: doc.weekendCount,
        total: doc.total,
        updatedAt: doc.updatedAt?.toISOString(),
      }))
    );
  } else {
    console.log("\nℹ️ DRY RUN COMPLETE. No changes were saved to the database.");
    console.log("To apply these changes to MongoDB, run:");
    console.log(
      `  node --env-file=.env.local scripts/import-duty-counts.js --apply\n`
    );
  }

  await mongoose.disconnect();
  console.log(" Disconnected from MongoDB.");
}

run().catch((err) => {
  console.error("❌ Fatal error executing script:", err);
  process.exit(1);
});
