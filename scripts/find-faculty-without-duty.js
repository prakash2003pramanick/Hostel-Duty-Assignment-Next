import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import ExcelJS from "exceljs";

/**
 * Script: Faculty With No Duty In Given Months (read-only report)
 *
 * Finds every faculty member who has ZERO DutyAssignment records across
 * all of the given months combined (default: July, September, October of
 * the current year). Does not modify any data.
 *
 * Usage:
 *   node --env-file=.env.local scripts/find-faculty-without-duty.js
 *   node --env-file=.env.local scripts/find-faculty-without-duty.js --year 2026
 *   node --env-file=.env.local scripts/find-faculty-without-duty.js --months 8,9,10
 */

function getArgumentValue(argName, defaultValue) {
  const idx = process.argv.indexOf(argName);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

const YEAR = parseInt(getArgumentValue("--year", String(new Date().getFullYear())), 10);
const MONTHS = getArgumentValue("--months", "8,9,10")
  .split(",")
  .map((m) => parseInt(m.trim(), 10))
  .filter((m) => m >= 1 && m <= 12);

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthRangeUTC(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0)); // exclusive
  return { start, end };
}

async function run() {
  console.log("==================================================");
  console.log(
    `🔍 Faculty-without-duty check: ${MONTHS.map((m) => MONTH_NAMES[m - 1]).join(", ")} ${YEAR}`
  );
  console.log("==================================================");

  if (!MONTHS.length) {
    console.error("❌ No valid months provided via --months.");
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error(
      "❌ MONGO_URI not found in environment. Please supply via --env-file=.env.local"
    );
    process.exit(1);
  }

  console.log(" Connecting to MongoDB...");
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(` Connected to MongoDB: ${mongoose.connection.name}`);

  const facultyCollection = db.collection("faculties");
  const dutyCollection = db.collection("dutyassignments");

  const faculties = await facultyCollection.find({}).toArray();
  console.log(` Loaded ${faculties.length} faculty members from database.`);

  const dateOr = MONTHS.map((m) => {
    const { start, end } = monthRangeUTC(YEAR, m);
    return { date: { $gte: start, $lt: end } };
  });

  const duties = await dutyCollection
    .find({ $or: dateOr })
    .project({ date: 1, faculty1: 1, faculty2: 1 })
    .toArray();

  console.log(
    ` Found ${duties.length} duty record(s) across ${MONTHS.map((m) => MONTH_NAMES[m - 1]).join("/")} ${YEAR}.`
  );

  // A faculty is "covered" (has duty in the window) if they appear as
  // faculty1 or faculty2 on any matching DutyAssignment, matched by
  // employeeCode (primary) or ObjectId (fallback), mirroring the matching
  // logic already used in loadFacultyLastAssignmentData().
  const coveredCodes = new Set();
  const coveredIds = new Set();

  for (const d of duties) {
    for (const f of [d.faculty1, d.faculty2]) {
      if (!f) continue;
      if (f.employeeCode) coveredCodes.add(String(f.employeeCode).trim());
      if (f.id) coveredIds.add(String(f.id));
    }
  }

  const missing = faculties.filter((f) => {
    const code = String(f.employeeCode ?? "").trim();
    const id = String(f._id);
    const hasCode = code && coveredCodes.has(code);
    const hasId = coveredIds.has(id);
    return !hasCode && !hasId;
  });

  console.log(
    `\n📊 ${missing.length} of ${faculties.length} faculty have NO duty in ${MONTHS.map((m) => MONTH_NAMES[m - 1]).join("/")} ${YEAR} (combined).\n`
  );

  const rows = missing
    .map((f) => ({
      employeeCode: f.employeeCode || "",
      name: f.name || "",
      title: f.title || "",
      designation: f.designation || "",
      orgUnit: f.orgUnit || "",
      employeeGroup: f.employeeGroup || "",
      gender: f.gender || "",
    }))
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  if (rows.length) {
    console.table(rows);
  } else {
    console.log("✅ Every faculty member has at least one duty in this window.");
  }

  // --- Write Excel report ---
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hostel Duty Assignment";
  const sheetTitle = `No duty ${MONTHS.map((m) => MONTH_NAMES[m - 1]).join("-")} ${YEAR}`.slice(0, 31);
  const sheet = workbook.addWorksheet(sheetTitle);

  const headers = [
    "Employee Code",
    "Name",
    "Title",
    "Designation",
    "Org Unit",
    "Employee Group",
    "Gender",
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  for (const r of rows) {
    const row = sheet.addRow([
      r.employeeCode,
      r.name,
      r.title,
      r.designation,
      r.orgUnit,
      r.employeeGroup,
      r.gender,
    ]);
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  }

  sheet.columns.forEach((col) => {
    if (!col?.eachCell) return;
    let maxLen = 12;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value ? String(cell.value) : "";
      maxLen = Math.max(maxLen, Math.min(v.length, 50));
    });
    col.width = Math.min(maxLen + 2, 50);
  });

  const reportsDir = path.resolve(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const monthsSlug = MONTHS.map((m) => MONTH_NAMES[m - 1]).join("-");
  const outPath = path.join(
    reportsDir,
    `faculty-without-duty_${monthsSlug}-${YEAR}.xlsx`
  );
  await workbook.xlsx.writeFile(outPath);
  console.log(`\n📁 Excel report written to: ${outPath}`);

  await mongoose.disconnect();
  console.log(" Disconnected from MongoDB.");
}

run().catch((err) => {
  console.error("❌ Fatal error executing script:", err);
  process.exit(1);
});
