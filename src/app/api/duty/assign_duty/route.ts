import { NextRequest, NextResponse } from "next/server";
import mongoose, { Types } from "mongoose";
import connectDB from "@/lib/db";
import Faculty from "@/lib/models/Faculty";
import Hostel from "@/lib/models/Hostel";
import Group from "@/lib/models/Group";
import DutyAssignment from "@/lib/models/DutyAssignment";
import {
  selectFacultiesForGroup,
  loadFacultyLastAssignmentData,
  mergeFacultyLastDutyIntoMaps,
  isWeekend,
  type SelectFacultiesOpts,
} from "@/lib/utils/facultySelection";

export async function POST(request: NextRequest) {
  const session = await mongoose.startSession();

  try {
    const body = await request.json();
    const {
      startDate,
      endDate,
      gender,
      excludedGroups = [],
      excludedSchools = [],
      excludedHostels = [],
      startFromWhereLeft = false,
      allowDuplicateEntries,
      reassign = false,
    } = body;

    const shouldResolveDuplicates =
      allowDuplicateEntries !== true && allowDuplicateEntries !== "true";

    if (!startDate || !endDate || !gender) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }

    await connectDB();

    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const groupHostelType =
      /^male$/i.test(gender) ? "BOYS" : /^female$/i.test(gender) ? "GIRLS" : gender;

    const groups = await Group.find({
      type: new RegExp(`^${groupHostelType}$`, "i"),
      name: { $nin: excludedGroups },
    }).lean();

    const hostels = await Hostel.find({
      type: new RegExp(`^${groupHostelType}$`, "i"),
      name: { $nin: excludedHostels },
    }).lean();

    const faculties = await Faculty.find({
      gender: new RegExp(`^${gender}$`, "i"),
      orgUnit: { $nin: excludedSchools },
    }).lean();

    if (!groups.length || !hostels.length || !faculties.length) {
      return NextResponse.json(
        { message: "Insufficient data" },
        { status: 404 }
      );
    }

    const hostelNames = hostels.map((h) => h.name);
    const groupNames = groups.map((g) => g.name);
    const hostelState = new Map<
      string,
      { name: string; numberOfRooms: number; nextRoom: number }
    >();

    const toNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    // When reassign=false, load existing assignments to preserve them
    type ExistingAssignment = {
      hostel: string;
      startRoom: number;
      endRoom: number;
      facultyIds: string[];
      faculty1?: { id: Types.ObjectId; name?: string; employeeGroup?: string };
      faculty2?: { id: Types.ObjectId; name?: string; employeeGroup?: string };
    };
    const existingByDateGroup = new Map<
      string,
      { assignments: ExistingAssignment[]; facultyIds: Set<string> }
    >();

    if (!reassign) {
      const existingDocs = await DutyAssignment.find({
        date: { $gte: start, $lte: end },
        hostel: { $in: hostelNames },
        group: { $in: groupNames },
      })
        .sort({ date: 1, group: 1 })
        .lean();

      for (const doc of existingDocs as unknown as Array<{
        date: Date;
        group: string;
        hostel: string;
        startRoom: number;
        endRoom: number;
        faculty1?: { id?: Types.ObjectId };
        faculty2?: { id?: Types.ObjectId };
      }>) {
        const dateStr = new Date(doc.date).toISOString().split("T")[0];
        const key = `${dateStr}__${doc.group}`;
        const facultyIds: string[] = [];
        if (doc.faculty1?.id) facultyIds.push(String(doc.faculty1.id));
        if (doc.faculty2?.id) facultyIds.push(String(doc.faculty2.id));
        if (!facultyIds.length) continue;

        let entry = existingByDateGroup.get(key);
        if (!entry) {
          entry = { assignments: [], facultyIds: new Set<string>() };
          existingByDateGroup.set(key, entry);
        }
        entry.assignments.push({
          hostel: doc.hostel,
          startRoom: toNum(doc.startRoom),
          endRoom: toNum(doc.endRoom),
          facultyIds,
          faculty1: doc.faculty1 as ExistingAssignment["faculty1"],
          faculty2: doc.faculty2 as ExistingAssignment["faculty2"],
        });
        facultyIds.forEach((id) => entry!.facultyIds.add(id));
      }
    }

    if (startFromWhereLeft) {
      const lastAssignments = await DutyAssignment.aggregate([
        { $match: { hostel: { $in: hostelNames } } },
        { $sort: { date: -1, createdAt: -1 } },
        { $group: { _id: "$hostel", lastEndRoom: { $first: "$endRoom" } } },
      ]);
      const lastRoomMap = new Map<string, number>();
      for (const row of lastAssignments) {
        lastRoomMap.set(row._id, toNum(row.lastEndRoom));
      }
      for (const h of hostels) {
        const lastRoom = lastRoomMap.get(h.name) ?? 0;
        hostelState.set(h.name, {
          name: h.name,
          numberOfRooms: Math.max(0, toNum(h.numberOfRooms)),
          nextRoom: lastRoom + 1,
        });
      }
    } else {
      for (const h of hostels) {
        hostelState.set(h.name, {
          name: h.name,
          numberOfRooms: Math.max(0, toNum(h.numberOfRooms)),
          nextRoom: 1,
        });
      }
    }

    const facultyIds = faculties.map((f) => f._id) as Types.ObjectId[];
    const {
      lastAssignmentMap,
      lastRoomRangeMap,
      lastWeekendMap,
    } = await loadFacultyLastAssignmentData(facultyIds, DutyAssignment);
    mergeFacultyLastDutyIntoMaps(
      faculties,
      lastAssignmentMap,
      lastRoomRangeMap,
      lastWeekendMap
    );

    const response: { groupName: string; assignments: unknown[] }[] = [];
    const bulkDutyOps: unknown[] = [];
    const facultyUpdates = new Map<
      string,
      {
        lastDuty: {
          date: Date;
          hostel: string;
          roomAlloted: string;
          numberOfRooms: number;
        };
        lastWeekEndDuty?: { date: Date };
      }
    >();

    session.startTransaction();

    let currentDate = new Date(start);
    let currentMonth = currentDate.getMonth();
    const alreadyAssignedThisMonth = new Set<string>();

    for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
      if (currentDate.getMonth() !== currentMonth) {
        alreadyAssignedThisMonth.clear();
        currentMonth = currentDate.getMonth();
      }

      const alreadyAssignedToday = new Set<string>();

      for (const group of groups) {
        const groupHostels = (group.hostelName || [])
          .map((hn: string) => hostelState.get(hn))
          .filter(Boolean);

        if (!groupHostels.length) continue;

        const dateStr = currentDate.toISOString().split("T")[0];
        const existingKey = `${dateStr}__${group.name}`;
        const existing = !reassign
          ? existingByDateGroup.get(existingKey)
          : undefined;

        let facultiesForDay: Array<{
          _id: unknown;
          name?: string;
          employeeCode?: string;
          title?: string;
          designation?: string;
          orgUnit?: string;
          employeeGroup?: string;
          gender?: string;
          personalEmail?: string;
          officialEmail?: string;
          mobile?: string;
        }>;

        if (existing && existing.facultyIds.size > 0) {
          // Use existing assignment - resolve faculty from faculties list, preserve order
          const facultyMap = new Map(
            faculties.map((f) => [String(f._id), f])
          );
          const ordered: Array<{
            _id: unknown;
            name?: string;
            employeeCode?: string;
            title?: string;
            designation?: string;
            orgUnit?: string;
            employeeGroup?: string;
            gender?: string;
            personalEmail?: string;
            officialEmail?: string;
            mobile?: string;
          }> = [];
          const seen = new Set<string>();
          for (const a of existing.assignments) {
            const ids = a.faculty1?.id
              ? [String(a.faculty1.id), ...(a.faculty2?.id ? [String(a.faculty2.id)] : [])]
              : a.facultyIds;
            for (const fid of ids) {
              if (seen.has(fid)) continue;
              seen.add(fid);
              const f = facultyMap.get(fid);
              if (f)
                ordered.push({
                  _id: f._id,
                  name: f.name,
                  employeeCode: f.employeeCode,
                  title: f.title,
                  designation: f.designation,
                  orgUnit: f.orgUnit,
                  employeeGroup: f.employeeGroup,
                  gender: f.gender,
                  personalEmail: f.personalEmail,
                  officialEmail: f.officialEmail,
                  mobile: f.mobile,
                });
            }
          }
          facultiesForDay = ordered;
        } else {
          facultiesForDay = selectFacultiesForGroup({
            group: group as unknown as SelectFacultiesOpts["group"],
            date: currentDate,
            faculties,
            lastAssignmentMap,
            lastRoomRangeMap,
            lastWeekendMap,
            groupHostels,
            planningDays: Math.max(1, totalDays - dayIndex),
            alreadyAssignedToday,
            alreadyAssignedThisMonth,
            allowDuplicateEntries: !shouldResolveDuplicates,
          });
        }

        const required = group.numberOfFacutlyPerDay;
        if (facultiesForDay.length < required) continue;

        facultiesForDay.forEach((f) =>
          alreadyAssignedThisMonth.add(String(f._id))
        );
        facultiesForDay.forEach((f) =>
          alreadyAssignedToday.add(String(f._id))
        );

        const fCount = facultiesForDay.length;

        let groupEntry = response.find((g) => g.groupName === group.name);
        if (!groupEntry) {
          groupEntry = { groupName: group.name, assignments: [] };
          response.push(groupEntry);
        }

        const dayAssignment = {
          date: dateStr,
          facultyAssignments: [] as {
            facultyId: unknown;
            facultyName: string;
            employeeCode: string;
            title?: string;
            designation?: string;
            orgUnit?: string;
            employeeGroup?: string;
            gender?: string;
            personalEmail?: string;
            officialEmail?: string;
            mobile?: string;
            hostel: string;
            roomRange: string;
          }[],
        };

        if (existing && existing.assignments.length > 0) {
          // Use existing: update hostel state, build response, no new inserts
          const facultyMap = new Map(
            faculties.map((f) => [String(f._id), f])
          );
          for (const a of existing.assignments) {
            const hostelObj = hostelState.get(a.hostel);
            if (hostelObj) {
              hostelObj.nextRoom = a.endRoom + 1;
            }
            const totalRooms = a.endRoom - a.startRoom + 1;
            const numFaculty = Math.max(1, a.facultyIds.length);
            const split = Math.max(1, Math.ceil(totalRooms / numFaculty));
            const facultyOrder = a.faculty1?.id
              ? [String(a.faculty1.id), ...(a.faculty2?.id ? [String(a.faculty2.id)] : [])]
              : a.facultyIds;
            let idx = 0;
            for (const fid of facultyOrder) {
              const faculty = facultiesForDay.find(
                (f) => String(f._id) === fid
              ) ?? facultyMap.get(fid);
              if (!faculty) continue;
              const fStart = a.startRoom + idx * split;
              const fEnd = Math.min(
                fStart + split - 1,
                a.endRoom
              );
              idx++;
              const roomRange = `${fStart}-${fEnd}`;
              dayAssignment.facultyAssignments.push({
                facultyId: faculty._id,
                facultyName: faculty.name || "",
                employeeCode: faculty.employeeCode || "",
                title: faculty.title,
                designation: faculty.designation,
                orgUnit: faculty.orgUnit,
                employeeGroup: faculty.employeeGroup,
                gender: faculty.gender,
                personalEmail: faculty.personalEmail,
                officialEmail: faculty.officialEmail,
                mobile: faculty.mobile,
                hostel: a.hostel,
                roomRange,
              });
            }
          }
        } else {
          // New assignment: normal flow
          let hostelBuckets: Array<{
            faculties: typeof facultiesForDay;
            hostels: typeof groupHostels;
          }>;
          if (fCount === 4) {
            const half = Math.floor(groupHostels.length / 2);
            hostelBuckets = [
              {
                faculties: facultiesForDay.slice(0, 2),
                hostels: groupHostels.slice(0, half),
              },
              {
                faculties: facultiesForDay.slice(2, 4),
                hostels: groupHostels.slice(half),
              },
            ];
          } else {
            hostelBuckets = [
              { faculties: facultiesForDay, hostels: groupHostels },
            ];
          }

          for (const bucket of hostelBuckets) {
            for (const hostel of bucket.hostels) {
              const assignedSoFar = hostel.nextRoom - 1;
              const remainingRooms =
                hostel.numberOfRooms - assignedSoFar;

              if (remainingRooms <= 0) continue;

              const remainingDays = Math.max(1, totalDays - dayIndex);
              const roomsToday = Math.max(
                1,
                Math.ceil(remainingRooms / remainingDays)
              );

              const startRoom = hostel.nextRoom;
              const endRoom = Math.min(
                hostel.nextRoom + roomsToday - 1,
                hostel.numberOfRooms
              );

              hostel.nextRoom = endRoom + 1;

              const totalRooms = endRoom - startRoom + 1;
              const numFaculty = bucket.faculties.length;
              const split = Math.max(
                1,
                Math.ceil(totalRooms / numFaculty)
              );

              bucket.faculties.forEach((faculty, idx) => {
                let fStart = startRoom + idx * split;
                let fEnd = Math.min(fStart + split - 1, endRoom);
                if (fStart > fEnd) {
                  fStart = startRoom;
                  fEnd = endRoom;
                }

                const roomRange = `${fStart}-${fEnd}`;
                dayAssignment.facultyAssignments.push({
                  facultyId: faculty._id,
                  facultyName: faculty.name || "",
                  employeeCode: faculty.employeeCode || "",
                  title: faculty.title,
                  designation: faculty.designation,
                  orgUnit: faculty.orgUnit,
                  employeeGroup: faculty.employeeGroup,
                  gender: faculty.gender,
                  personalEmail: faculty.personalEmail,
                  officialEmail: faculty.officialEmail,
                  mobile: faculty.mobile,
                  hostel: hostel.name,
                  roomRange,
                });

                const fid = String(faculty._id);
                const dateMs = currentDate.getTime();
                facultyUpdates.set(fid, {
                  lastDuty: {
                    date: new Date(currentDate),
                    hostel: hostel.name,
                    roomAlloted: roomRange,
                    numberOfRooms: fEnd - fStart + 1,
                  },
                  ...(isWeekend(currentDate) && {
                    lastWeekEndDuty: { date: new Date(currentDate) },
                  }),
                });
                lastAssignmentMap.set(fid, dateMs);
                lastRoomRangeMap.set(fid, roomRange);
                if (isWeekend(currentDate))
                  lastWeekendMap.set(fid, dateMs);
              });

              const toFacultyDoc = (f: (typeof bucket.faculties)[0] | null) =>
                f
                  ? {
                      id: f._id,
                      name: f.name,
                      employeeGroup: f.employeeGroup,
                    }
                  : null;

              const safeStart = Math.floor(toNum(startRoom));
              const safeEnd = Math.floor(toNum(endRoom));
              if (Number.isFinite(safeStart) && Number.isFinite(safeEnd) && safeStart <= safeEnd) {
                bulkDutyOps.push({
                  insertOne: {
                    document: {
                      date: new Date(currentDate),
                      group: group.name,
                      hostel: hostel.name,
                      startRoom: safeStart,
                      endRoom: safeEnd,
                      roomRange: `${safeStart}-${safeEnd}`,
                      faculty1: toFacultyDoc(bucket.faculties[0]),
                      faculty2: toFacultyDoc(bucket.faculties[1]),
                    },
                  },
                });
              }
            }
          }
        }

        if (dayAssignment.facultyAssignments.length) {
          groupEntry.assignments.push(dayAssignment);
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (bulkDutyOps.length) {
      await DutyAssignment.bulkWrite(bulkDutyOps as never[], { session });
    }

    if (facultyUpdates.size) {
      const facultyBulkOps = [];
      for (const [fid, update] of facultyUpdates) {
        facultyBulkOps.push({
          updateOne: {
            filter: { _id: fid },
            update: { $set: update },
          },
        });
      }
      await Faculty.bulkWrite(facultyBulkOps as never[], { session });
    }

    await session.commitTransaction();
    session.endSession();

    return NextResponse.json(response);
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
