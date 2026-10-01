import mongoose from "mongoose";

/**
 * Script: Swap faculty on an already generated month's duty list
 *
 * For every "OLD:NEW" pair this script:
 *  1. Replaces OLD with NEW in the single DutyAssignment (faculty1 or faculty2)
 *     that OLD holds in the target month (room ranges are untouched).
 *  2. Moves the duty count: OLD -1, NEW +1 (weekday or weekend bucket, from the
 *     duty date, plus `total`).
 *  3. Recomputes OLD's lastDuty / lastWeekEndDuty from the remaining history and
 *     sets NEW's lastDuty / lastWeekEndDuty to this duty.
 *
 * NEW must have no duty in the target month. Everything runs in one transaction.
 *
 * Usage:
 *   DRY RUN (default, no DB changes):
 *     node --env-file=.env.local scripts/swap-oct-faculty.js
 *   APPLY CHANGES:
 *     node --env-file=.env.local scripts/swap-oct-faculty.js --apply
 *   Custom pairs / month:
 *     node --env-file=.env.local scripts/swap-oct-faculty.js --swap 106806:100061,106846:104199 --year 2026 --month 10
 */

const APPLY = process.argv.includes("--apply");

function getArgumentValue(argName, defaultValue) {
  const idx = process.argv.indexOf(argName);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return defaultValue;
}

const YEAR = parseInt(getArgumentValue("--year", "2026"), 10);
const MONTH = parseInt(getArgumentValue("--month", "10"), 10);
const SWAPS = getArgumentValue("--swap", "106806:100061,106846:104199")
  .split(",")
  .map((p) => p.split(":").map((s) => s.trim()))
  .filter((p) => p.length === 2 && p[0] && p[1]);

const isWeekend = (date) => {
  const d = new Date(date).getDay();
  return d === 0 || d === 6;
};

function fail(msg) {
  throw new Error(msg);
}

// Faculty's own room share in a duty doc: faculty1 gets the first half, faculty2 the rest.
function ownRoomShare(doc, position) {
  const totalRooms = doc.endRoom - doc.startRoom + 1;
  const hasF2 = doc.faculty2?.id || doc.faculty2?.employeeCode;
  const split = Math.ceil(totalRooms / (hasF2 ? 2 : 1));
  const f1End = Math.min(doc.startRoom + split - 1, doc.endRoom);
  if (position === 1) {
    return { range: `${doc.startRoom}-${f1End}`, rooms: f1End - doc.startRoom + 1 };
  }
  return { range: `${f1End + 1}-${doc.endRoom}`, rooms: doc.endRoom - f1End };
}

function slotOf(doc, faculty) {
  const code = String(faculty.employeeCode).trim();
  const id = String(faculty._id);
  const matches = (f) =>
    f && (String(f.employeeCode ?? "").trim() === code || String(f.id ?? "") === id);
  if (matches(doc.faculty1)) return 1;
  if (matches(doc.faculty2)) return 2;
  return 0;
}

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI not found in environment. Please supply via --env-file=.env.local");
    process.exit(1);
  }
  if (!SWAPS.length) {
    console.error("❌ No valid pairs. Use --swap OLD:NEW[,OLD:NEW...]");
    process.exit(1);
  }

  console.log("==================================================");
  console.log(`🔁 Faculty swap (${APPLY ? "APPLY MODE" : "DRY RUN"}) — ${YEAR}-${String(MONTH).padStart(2, "0")}`);
  console.log("==================================================");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(` Connected to MongoDB: ${mongoose.connection.name}`);

  const facultyCol = db.collection("faculties");
  const dutyCol = db.collection("dutyassignments");
  const countCol = db.collection("counts");

  const start = new Date(Date.UTC(YEAR, MONTH - 1, 1));
  const end = new Date(Date.UTC(YEAR, MONTH, 1));
  const monthFilter = { date: { $gte: start, $lt: end } };
  const facultyMatch = (f) => ({
    $or: [
      { "faculty1.employeeCode": f.employeeCode },
      { "faculty2.employeeCode": f.employeeCode },
      { "faculty1.id": f._id },
      { "faculty2.id": f._id },
    ],
  });

  const usedCodes = new Set();
  const plan = [];

  // ---- Validate everything before writing anything ----
  for (const [oldCode, newCode] of SWAPS) {
    if (usedCodes.has(oldCode) || usedCodes.has(newCode)) fail(`Employee code repeated across pairs: ${oldCode}/${newCode}`);
    usedCodes.add(oldCode);
    usedCodes.add(newCode);

    const oldF = await facultyCol.findOne({ employeeCode: oldCode });
    const newF = await facultyCol.findOne({ employeeCode: newCode });
    if (!oldF) fail(`Faculty ${oldCode} not found`);
    if (!newF) fail(`Faculty ${newCode} not found`);

    const oldDuties = await dutyCol.find({ ...monthFilter, ...facultyMatch(oldF) }).toArray();
    if (oldDuties.length !== 1) {
      fail(`${oldCode} has ${oldDuties.length} duty record(s) in the month; expected exactly 1 (already swapped?)`);
    }
    const duty = oldDuties[0];

    const newDuties = await dutyCol.countDocuments({ ...monthFilter, ...facultyMatch(newF) });
    if (newDuties > 0) fail(`${newCode} already has ${newDuties} duty record(s) in the month`);

    const onLeave = (newF.leave || []).some(
      (l) => new Date(duty.date) >= new Date(l.startDate) && new Date(duty.date) <= new Date(l.endDate)
    );
    if (onLeave) fail(`${newCode} is on leave on ${duty.date.toISOString().slice(0, 10)}`);

    const slot = slotOf(duty, oldF);
    if (!slot) fail(`Could not locate ${oldCode} in duty ${duty._id}`);

    const weekend = isWeekend(duty.date);
    const share = ownRoomShare(duty, slot);

    // OLD's last duty from history that remains after removing this duty
    const remaining = await dutyCol
      .find({ ...facultyMatch(oldF), _id: { $ne: duty._id } })
      .sort({ date: -1 })
      .toArray();
    let oldLastDuty = null;
    let oldLastWeekend = null;
    for (const d of remaining) {
      const s = slotOf(d, oldF) || 1;
      if (!oldLastDuty) {
        const sh = ownRoomShare(d, s);
        oldLastDuty = { date: d.date, hostel: d.hostel, roomAlloted: sh.range, numberOfRooms: sh.rooms };
      }
      if (!oldLastWeekend && isWeekend(d.date)) oldLastWeekend = { date: d.date };
      if (oldLastDuty && oldLastWeekend) break;
    }

    const oldCount = await countCol.findOne({ empId: oldCode });
    const bucket = weekend ? "weekendCount" : "weekdaysCount";
    if (!oldCount || (oldCount[bucket] || 0) < 1 || (oldCount.total || 0) < 1) {
      fail(`${oldCode} Count doc has ${bucket}/total below 1; refusing to go negative`);
    }
    const newCount = await countCol.findOne({ empId: newCode });

    plan.push({ oldF, newF, duty, slot, weekend, bucket, share, oldLastDuty, oldLastWeekend, oldCount, newCount });
  }

  // ---- Report ----
  for (const p of plan) {
    console.log("\n--------------------------------------------------");
    console.log(` ${p.oldF.employeeCode} ${p.oldF.name?.trim()}  →  ${p.newF.employeeCode} ${p.newF.name?.trim()} (${p.newF.employeeGroup}, ${p.newF.orgUnit})`);
    console.log(`   Duty ${p.duty._id}: ${p.duty.date.toISOString().slice(0, 10)} ${p.weekend ? "(weekend)" : "(weekday)"} ${p.duty.group} ${p.duty.hostel} rooms ${p.share.range}, slot faculty${p.slot}`);
    const c = (x) => (x ? `w${x.weekendCount || 0} d${x.weekdaysCount || 0} t${x.total || 0}` : "none");
    console.log(`   Count ${p.oldF.employeeCode}: ${c(p.oldCount)} → ${p.bucket} -1, total -1`);
    console.log(`   Count ${p.newF.employeeCode}: ${c(p.newCount)} → ${p.bucket} +1, total +1`);
    console.log(`   ${p.oldF.employeeCode} lastDuty: ${JSON.stringify(p.oldF.lastDuty)} → ${p.oldLastDuty ? JSON.stringify(p.oldLastDuty) : "(unset)"}`);
    console.log(`   ${p.oldF.employeeCode} lastWeekEndDuty: ${JSON.stringify(p.oldF.lastWeekEndDuty)} → ${p.oldLastWeekend ? JSON.stringify(p.oldLastWeekend) : "(unset)"}`);
    console.log(`   ${p.newF.employeeCode} lastDuty → ${p.duty.date.toISOString().slice(0, 10)} ${p.duty.hostel} ${p.share.range}${p.weekend ? " (+ lastWeekEndDuty)" : ""}`);
  }

  if (!APPLY) {
    console.log("\n DRY RUN complete. Re-run with --apply to write changes (take a backup first: npm run backup-db).");
    await mongoose.disconnect();
    return;
  }

  // ---- Apply in one transaction ----
  const session = await mongoose.connection.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      for (const p of plan) {
        const slotKey = `faculty${p.slot}`;
        await dutyCol.updateOne(
          { _id: p.duty._id },
          {
            $set: {
              [slotKey]: {
                id: p.newF._id,
                employeeCode: p.newF.employeeCode,
                name: p.newF.name,
                employeeGroup: p.newF.employeeGroup,
              },
              updatedAt: now,
            },
          },
          { session }
        );

        await countCol.updateOne(
          { empId: p.oldF.employeeCode },
          { $inc: { [p.bucket]: -1, total: -1 }, $set: { updatedAt: now } },
          { session }
        );
        await countCol.updateOne(
          { empId: p.newF.employeeCode },
          {
            $inc: { [p.bucket]: 1, total: 1 },
            $set: { updatedAt: now },
            $setOnInsert: { empId: p.newF.employeeCode, createdAt: now },
          },
          { upsert: true, session }
        );

        const oldSet = {};
        const oldUnset = {};
        if (p.oldLastDuty) oldSet.lastDuty = p.oldLastDuty;
        else oldUnset.lastDuty = "";
        if (p.oldLastWeekend) oldSet.lastWeekEndDuty = p.oldLastWeekend;
        else oldUnset.lastWeekEndDuty = "";
        await facultyCol.updateOne(
          { _id: p.oldF._id },
          {
            ...(Object.keys(oldSet).length && { $set: oldSet }),
            ...(Object.keys(oldUnset).length && { $unset: oldUnset }),
          },
          { session }
        );

        await facultyCol.updateOne(
          { _id: p.newF._id },
          {
            $set: {
              lastDuty: {
                date: p.duty.date,
                hostel: p.duty.hostel,
                roomAlloted: p.share.range,
                numberOfRooms: p.share.rooms,
              },
              ...(p.weekend && { lastWeekEndDuty: { date: p.duty.date } }),
            },
          },
          { session }
        );
      }
    });
    console.log("\n✅ Swap applied and committed.");
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error("❌ Fatal error executing script:", err.message || err);
  process.exit(1);
});
