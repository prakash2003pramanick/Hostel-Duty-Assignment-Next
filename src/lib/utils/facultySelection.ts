/**
 * Faculty selection utilities for duty assignment.
 * Handles LRU, school matching, weekend fairness, room range avoidance, and teaching/non-teaching pairing.
 */

import type { Types } from "mongoose";

// --- Teaching / Non-Teaching classification ---
// TEACHING = teaching; anything else = non-teaching
const isTeaching = (faculty: { employeeGroup?: string }) =>
  (faculty.employeeGroup || "")
    .toString()
    .trim()
    .toUpperCase() === "TEACHING";

const isNonTeaching = (faculty: { employeeGroup?: string }) =>
  !isTeaching(faculty);

// --- Weekend check ---
export const isWeekend = (date: Date) => {
  const d = new Date(date).getDay();
  return d === 0 || d === 6; // Sunday=0, Saturday=6
};

// --- Leave check ---
const isOnLeave = (
  faculty: { leave?: { startDate: Date; endDate: Date }[] },
  date: Date
) =>
  (faculty.leave || []).some(
    (l) =>
      date >= new Date(l.startDate) && date <= new Date(l.endDate)
  );

// --- Simulate room ranges for a bucket (without mutating hostel state) ---
const simulateRoomRangesForBucket = (
  bucketHostels: { nextRoom: number; numberOfRooms: number }[],
  numFaculty: number,
  planningDays: number
) => {
  const rangesPerFacultyIndex = Array.from(
    { length: numFaculty },
    () => [] as string[]
  );

  for (const hostel of bucketHostels) {
    const assignedSoFar = hostel.nextRoom - 1;
    const remainingRooms = hostel.numberOfRooms - assignedSoFar;
    if (remainingRooms <= 0) continue;

    const roomsToday = Math.ceil(remainingRooms / planningDays);
    const startRoom = hostel.nextRoom;
    const endRoom = Math.min(
      hostel.nextRoom + roomsToday - 1,
      hostel.numberOfRooms
    );
    const totalRooms = endRoom - startRoom + 1;
    const split = Math.ceil(totalRooms / numFaculty);

    for (let idx = 0; idx < numFaculty; idx++) {
      const fStart = startRoom + idx * split;
      const fEnd = Math.min(fStart + split - 1, endRoom);
      if (fStart <= fEnd) {
        rangesPerFacultyIndex[idx].push(`${fStart}-${fEnd}`);
      }
    }
  }

  return rangesPerFacultyIndex;
};

// --- Check if faculty's last room range would conflict with any of the simulated ranges ---
const hasSameRoomRangeAsLast = (
  faculty: { _id: Types.ObjectId },
  simulatedRanges: string[] | string | null,
  lastRoomRangeMap: Map<string, string>
) => {
  const lastRange = lastRoomRangeMap.get(faculty._id.toString());
  if (!lastRange) return false;

  const ranges = Array.isArray(simulatedRanges)
    ? simulatedRanges
    : simulatedRanges
      ? [simulatedRanges]
      : [];
  return ranges.some((r) => r === lastRange);
};

interface FacultyDoc {
  _id: Types.ObjectId;
  employeeGroup?: string;
  orgUnit?: string;
}

// --- Build faculty pools by school match and type ---
const buildFacultyPools = (
  faculties: FacultyDoc[],
  groupSchool: string
) => {
  const teaching: FacultyDoc[] = [];
  const nonTeaching: FacultyDoc[] = [];

  for (const f of faculties) {
    if (isTeaching(f)) teaching.push(f);
    else if (isNonTeaching(f)) nonTeaching.push(f);
  }

  const matchSchool = (f: FacultyDoc) =>
    (f.orgUnit || "").toString().trim().toLowerCase() ===
    (groupSchool || "").toString().trim().toLowerCase();

  const teachingSameSchool = teaching.filter(matchSchool);
  const teachingOther = teaching.filter((f) => !matchSchool(f));
  const nonTeachingSameSchool = nonTeaching.filter(matchSchool);
  const nonTeachingOther = nonTeaching.filter((f) => !matchSchool(f));

  return {
    teachingSameSchool,
    teachingOther,
    nonTeachingSameSchool,
    nonTeachingOther,
    teaching: teachingSameSchool.length
      ? teachingSameSchool.concat(teachingOther)
      : teaching,
    nonTeaching: nonTeachingSameSchool.length
      ? nonTeachingSameSchool.concat(nonTeachingOther)
      : nonTeaching,
    all: faculties,
  };
};

interface PickOneOpts {
  pool: FacultyDoc[];
  date: Date;
  excludeIds: Set<string>;
  lastRoomRanges: Map<string, string>;
  simulatedRangesForPosition: string[] | null;
  lastAssignmentMap: Map<string, number>;
  lastWeekendMap: Map<string, number>;
  preferWeekendFairness: boolean;
  alreadyAssignedThisMonth: Set<string>;
  allowDuplicateEntries?: boolean;
}

// --- Pick one faculty from pool (LRU + weekend fairness + filters) ---
const pickOne = (opts: PickOneOpts): FacultyDoc | null => {
  const {
    pool,
    date,
    excludeIds,
    lastRoomRanges,
    simulatedRangesForPosition,
    lastAssignmentMap,
    lastWeekendMap,
    preferWeekendFairness,
    alreadyAssignedThisMonth = new Set(),
    allowDuplicateEntries = false,
  } = opts;

  const weekend = isWeekend(date);

  let eligible = pool.filter((f) => {
    const fid = f._id.toString();
    if (excludeIds.has(fid)) return false;
    if (isOnLeave(f as { leave?: { startDate: Date; endDate: Date }[] }, date))
      return false;
    if (
      simulatedRangesForPosition &&
      hasSameRoomRangeAsLast(f, simulatedRangesForPosition, lastRoomRanges)
    )
      return false;

    if (weekend && preferWeekendFairness) {
      const someoneNeverDidWeekend = pool.some(
        (p) => !lastWeekendMap.get(p._id.toString())
      );
      if (someoneNeverDidWeekend && lastWeekendMap.get(fid)) return false;
    }

    return true;
  });

  const assignedThisMonth = alreadyAssignedThisMonth || new Set();
  if (!allowDuplicateEntries) {
    eligible = eligible.filter(
      (f) => !assignedThisMonth.has(f._id.toString())
    );
  }
  if (!eligible.length) return null;

  const allEligibleAssigned =
    allowDuplicateEntries &&
    eligible.every((f) => assignedThisMonth.has(f._id.toString()));

  eligible.sort((a, b) => {
    const aId = a._id.toString();
    const bId = b._id.toString();

    if (!allEligibleAssigned) {
      const aAssigned = assignedThisMonth.has(aId);
      const bAssigned = assignedThisMonth.has(bId);
      if (aAssigned !== bAssigned) return aAssigned ? 1 : -1;
    }

    const aDate = lastAssignmentMap.get(aId) || 0;
    const bDate = lastAssignmentMap.get(bId) || 0;
    if (aDate !== bDate) return aDate - bDate;

    if (weekend && preferWeekendFairness) {
      const aWd = lastWeekendMap.get(aId) || 0;
      const bWd = lastWeekendMap.get(bId) || 0;
      return aWd - bWd;
    }

    return 0;
  });

  return eligible[0];
};

export interface SelectFacultiesOpts {
  group: { numberOfFacutlyPerDay: number; school?: string; hostelName?: string[] };
  date: Date;
  faculties: FacultyDoc[];
  lastAssignmentMap: Map<string, number>;
  lastRoomRangeMap: Map<string, string>;
  lastWeekendMap: Map<string, number>;
  groupHostels: { nextRoom: number; numberOfRooms: number; name: string }[];
  planningDays: number;
  alreadyAssignedToday: Set<string>;
  alreadyAssignedThisMonth?: Set<string>;
  allowDuplicateEntries?: boolean;
}

/**
 * Select faculties for a group based on all rules.
 */
export const selectFacultiesForGroup = (
  opts: SelectFacultiesOpts
): FacultyDoc[] => {
  const {
    group,
    date,
    faculties,
    lastAssignmentMap,
    lastRoomRangeMap,
    lastWeekendMap,
    groupHostels,
    planningDays,
    alreadyAssignedToday,
    alreadyAssignedThisMonth = new Set(),
    allowDuplicateEntries = false,
  } = opts;

  const n = group.numberOfFacutlyPerDay;
  const weekend = isWeekend(date);
  const pools = buildFacultyPools(faculties, group.school || "");

  const excludeIds = new Set(alreadyAssignedToday);
  const selected: FacultyDoc[] = [];
  const addToExclude = (f: FacultyDoc | null) => {
    if (f) {
      const fid = f._id.toString();
      excludeIds.add(fid);
      alreadyAssignedToday.add(fid);
    }
  };

  if (n === 1) {
    const preferPool = weekend ? pools.nonTeaching : pools.teaching;
    const fallbackPool = weekend ? pools.teaching : pools.nonTeaching;
    const pool = preferPool.length
      ? preferPool
      : fallbackPool.length
        ? fallbackPool
        : pools.all;
    const rangesForSingle = simulateRoomRangesForBucket(
      groupHostels,
      1,
      planningDays
    );
    const allRanges = rangesForSingle[0] || [];
    const f = pickOne({
      pool,
      date,
      excludeIds,
      lastRoomRanges: lastRoomRangeMap,
      simulatedRangesForPosition: allRanges.length ? allRanges : null,
      lastAssignmentMap,
      lastWeekendMap,
      preferWeekendFairness: weekend,
      alreadyAssignedThisMonth,
      allowDuplicateEntries,
    });
    if (f) {
      addToExclude(f);
      selected.push(f);
    }
    return selected;
  }

  if (n === 2) {
    const bucketHostels = groupHostels;
    const rangesPerIndex = simulateRoomRangesForBucket(
      bucketHostels,
      2,
      planningDays
    );

    const pickWithFallback = (
      preferPool: FacultyDoc[],
      fallbackPool: FacultyDoc[],
      ranges: string[]
    ) => {
      let f = pickOne({
        pool: preferPool,
        date,
        excludeIds,
        lastRoomRanges: lastRoomRangeMap,
        simulatedRangesForPosition: ranges,
        lastAssignmentMap,
        lastWeekendMap,
        preferWeekendFairness: weekend,
        alreadyAssignedThisMonth,
        allowDuplicateEntries,
      });
      if (!f && fallbackPool.length) {
        f = pickOne({
          pool: fallbackPool,
          date,
          excludeIds,
          lastRoomRanges: lastRoomRangeMap,
          simulatedRangesForPosition: ranges,
          lastAssignmentMap,
          lastWeekendMap,
          preferWeekendFairness: weekend,
          alreadyAssignedThisMonth,
          allowDuplicateEntries,
        });
      }
      if (!f) {
        f = pickOne({
          pool: pools.all,
          date,
          excludeIds,
          lastRoomRanges: lastRoomRangeMap,
          simulatedRangesForPosition: ranges,
          lastAssignmentMap,
          lastWeekendMap,
          preferWeekendFairness: weekend,
          alreadyAssignedThisMonth,
          allowDuplicateEntries,
        });
      }
      return f;
    };

    const t = pickWithFallback(
      pools.teaching,
      pools.nonTeaching,
      rangesPerIndex[0]
    );
    addToExclude(t);
    if (t) selected.push(t);

    const nt = pickWithFallback(
      pools.nonTeaching,
      pools.teaching,
      rangesPerIndex[1]
    );
    addToExclude(nt);
    if (nt) selected.push(nt);

    return selected;
  }

  if (n === 4) {
    const half = Math.floor(groupHostels.length / 2);
    const bucket1Hostels = groupHostels.slice(0, half);
    const bucket2Hostels = groupHostels.slice(half);

    const ranges1 = simulateRoomRangesForBucket(
      bucket1Hostels,
      2,
      planningDays
    );
    const ranges2 = simulateRoomRangesForBucket(
      bucket2Hostels,
      2,
      planningDays
    );

    const pickWithFallback = (
      preferPool: FacultyDoc[],
      fallbackPool: FacultyDoc[],
      ranges: string[]
    ) => {
      let f = pickOne({
        pool: preferPool,
        date,
        excludeIds,
        lastRoomRanges: lastRoomRangeMap,
        simulatedRangesForPosition: ranges,
        lastAssignmentMap,
        lastWeekendMap,
        preferWeekendFairness: weekend,
        alreadyAssignedThisMonth,
        allowDuplicateEntries,
      });
      if (!f && fallbackPool.length) {
        f = pickOne({
          pool: fallbackPool,
          date,
          excludeIds,
          lastRoomRanges: lastRoomRangeMap,
          simulatedRangesForPosition: ranges,
          lastAssignmentMap,
          lastWeekendMap,
          preferWeekendFairness: weekend,
          alreadyAssignedThisMonth,
          allowDuplicateEntries,
        });
      }
      if (!f) {
        f = pickOne({
          pool: pools.all,
          date,
          excludeIds,
          lastRoomRanges: lastRoomRangeMap,
          simulatedRangesForPosition: ranges,
          lastAssignmentMap,
          lastWeekendMap,
          preferWeekendFairness: weekend,
          alreadyAssignedThisMonth,
          allowDuplicateEntries,
        });
      }
      return f;
    };

    const t1 = pickWithFallback(
      pools.teaching,
      pools.nonTeaching,
      ranges1[0]
    );
    addToExclude(t1);
    if (t1) selected.push(t1);

    const nt1 = pickWithFallback(
      pools.nonTeaching,
      pools.teaching,
      ranges1[1]
    );
    addToExclude(nt1);
    if (nt1) selected.push(nt1);

    const t2 = pickWithFallback(
      pools.teaching,
      pools.nonTeaching,
      ranges2[0]
    );
    addToExclude(t2);
    if (t2) selected.push(t2);

    const nt2 = pickWithFallback(
      pools.nonTeaching,
      pools.teaching,
      ranges2[1]
    );
    addToExclude(nt2);
    if (nt2) selected.push(nt2);

    return selected;
  }

  return [];
};

interface DutyAssignmentDoc {
  faculty1?: { id?: Types.ObjectId };
  faculty2?: { id?: Types.ObjectId };
  date: Date;
  startRoom: number;
  endRoom: number;
  createdAt?: Date;
}

/**
 * Load last assignment and room range data per faculty from DutyAssignment.
 * Returns { lastAssignmentMap, lastRoomRangeMap, lastWeekendMap }.
 */
export const loadFacultyLastAssignmentData = async (
  facultyIds: Types.ObjectId[],
  DutyAssignment: {
    find: (q: object) => {
      sort: (s: object) => { lean: () => Promise<DutyAssignmentDoc[]> };
    };
  }
) => {
  const lastAssignmentMap = new Map<string, number>();
  const lastRoomRangeMap = new Map<string, string>();
  const lastWeekendMap = new Map<string, number>();

  if (!facultyIds.length)
    return { lastAssignmentMap, lastRoomRangeMap, lastWeekendMap };

  const ids = facultyIds.map((id) => id.toString());
  const docs = await DutyAssignment.find({
    $or: [
      { "faculty1.id": { $in: facultyIds } },
      { "faculty2.id": { $in: facultyIds } },
    ],
  })
    .sort({ date: -1, createdAt: -1 })
    .lean();

  for (const d of docs) {
    const totalRooms = d.endRoom - d.startRoom + 1;
    const hasF2 = d.faculty2?.id;
    const numFaculty = hasF2 ? 2 : 1;
    const split = Math.ceil(totalRooms / numFaculty);
    const f1Range = `${d.startRoom}-${Math.min(
      d.startRoom + split - 1,
      d.endRoom
    )}`;
    const f2Start = d.startRoom + split;
    const f2Range =
      hasF2 && f2Start <= d.endRoom ? `${f2Start}-${d.endRoom}` : null;

    const dateMs = new Date(d.date).getTime();
    const weekend =
      new Date(d.date).getDay() === 0 || new Date(d.date).getDay() === 6;

    if (d.faculty1?.id && ids.includes(d.faculty1.id.toString())) {
      const fid = d.faculty1.id.toString();
      if (!lastAssignmentMap.has(fid)) lastAssignmentMap.set(fid, dateMs);
      if (!lastRoomRangeMap.has(fid)) lastRoomRangeMap.set(fid, f1Range);
      if (weekend && !lastWeekendMap.has(fid))
        lastWeekendMap.set(fid, dateMs);
    }
    if (d.faculty2?.id && ids.includes(d.faculty2.id.toString())) {
      const fid = d.faculty2.id.toString();
      if (!lastAssignmentMap.has(fid)) lastAssignmentMap.set(fid, dateMs);
      if (f2Range && !lastRoomRangeMap.has(fid))
        lastRoomRangeMap.set(fid, f2Range);
      if (weekend && !lastWeekendMap.has(fid))
        lastWeekendMap.set(fid, dateMs);
    }
  }

  return { lastAssignmentMap, lastRoomRangeMap, lastWeekendMap };
};

interface FacultyWithLastDuty {
  _id: Types.ObjectId;
  lastDuty?: { date?: Date; roomAlloted?: string };
  lastWeekEndDuty?: { date?: Date };
}

/**
 * Merge Faculty.lastDuty and Faculty.lastWeekEndDuty into the maps.
 */
export const mergeFacultyLastDutyIntoMaps = (
  faculties: FacultyWithLastDuty[],
  lastAssignmentMap: Map<string, number>,
  lastRoomRangeMap: Map<string, string>,
  lastWeekendMap: Map<string, number>
) => {
  for (const f of faculties) {
    const fid = f._id.toString();
    if (f.lastDuty?.date) {
      const d = new Date(f.lastDuty.date).getTime();
      if (!lastAssignmentMap.has(fid) || lastAssignmentMap.get(fid)! < d)
        lastAssignmentMap.set(fid, d);
    }
    if (f.lastDuty?.roomAlloted) {
      if (!lastRoomRangeMap.has(fid))
        lastRoomRangeMap.set(fid, f.lastDuty.roomAlloted);
    }
    if (f.lastWeekEndDuty?.date) {
      const d = new Date(f.lastWeekEndDuty.date).getTime();
      if (!lastWeekendMap.has(fid) || lastWeekendMap.get(fid)! < d)
        lastWeekendMap.set(fid, d);
    }
  }
};
