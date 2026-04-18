import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Faculty from "@/lib/models/Faculty";
import DutyAssignment from "@/lib/models/DutyAssignment";
import {
  buildFacultyReportExcel,
  type DutySlot,
  type FacultyReportRow,
} from "@/lib/utils/facultyReportExcel";

type LeanFaculty = {
  _id: unknown;
  employeeCode?: string;
  title?: string;
  name?: string;
  designation?: string;
  orgUnit?: string;
  officialEmail?: string;
  personalEmail?: string;
  mobile?: string;
  employeeGroup?: string;
  gender?: string;
};

type RawDutyPart = { date: Date; hostel: string; roomRange: string };

/** Group raw assignment rows by calendar day (UTC); one duty = one day. */
function aggregateDutiesByDay(raw: RawDutyPart[]): DutySlot[] {
  const byDay = new Map<
    string,
    { parts: { hostel: string; roomRange: string }[] }
  >();

  for (const r of raw) {
    const key = new Date(r.date).toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, { parts: [] });
    byDay.get(key)!.parts.push({
      hostel: String(r.hostel ?? "").trim() || "-",
      roomRange: String(r.roomRange ?? "").trim() || "-",
    });
  }

  const sortedKeys = [...byDay.keys()].sort();
  return sortedKeys.map((key) => {
    const { parts } = byDay.get(key)!;
    parts.sort((a, b) => a.hostel.localeCompare(b.hostel, undefined, { sensitivity: "base" }));
    return {
      date: new Date(`${key}T00:00:00.000Z`),
      parts,
    };
  });
}

function facultyToRow(f: LeanFaculty, duties: DutySlot[]): FacultyReportRow {
  return {
    employeeCode: String(f.employeeCode || ""),
    title: String(f.title || ""),
    name: String(f.name || ""),
    designation: String(f.designation || ""),
    orgUnit: String(f.orgUnit || ""),
    officialEmail: String(f.officialEmail || ""),
    personalEmail: String(f.personalEmail || ""),
    mobile: String(f.mobile || ""),
    employeeGroup: String(f.employeeGroup || ""),
    gender: String(f.gender || ""),
    duties,
  };
}

async function dutySlotsByFacultyId(): Promise<Map<string, DutySlot[]>> {
  const duties = await DutyAssignment.find({})
    .select("date hostel roomRange faculty1.id faculty2.id")
    .sort({ date: 1 })
    .lean();

  const rawMap = new Map<string, RawDutyPart[]>();

  for (const d of duties) {
    const doc = d as unknown as {
      date: Date;
      hostel?: string;
      roomRange?: string;
      faculty1?: { id?: unknown };
      faculty2?: { id?: unknown };
    };
    const part: RawDutyPart = {
      date: new Date(doc.date),
      hostel: String(doc.hostel ?? ""),
      roomRange: String(doc.roomRange ?? ""),
    };
    const id1 = doc.faculty1?.id != null ? String(doc.faculty1.id) : "";
    const id2 = doc.faculty2?.id != null ? String(doc.faculty2.id) : "";
    if (id1) {
      if (!rawMap.has(id1)) rawMap.set(id1, []);
      rawMap.get(id1)!.push(part);
    }
    if (id2 && id2 !== id1) {
      if (!rawMap.has(id2)) rawMap.set(id2, []);
      rawMap.get(id2)!.push(part);
    }
  }

  const map = new Map<string, DutySlot[]>();
  for (const [id, raw] of rawMap) {
    map.set(id, aggregateDutiesByDay(raw));
  }
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "employee" ? "employee" : "all";
    const employeeCode =
      typeof body.employeeCode === "string" ? body.employeeCode.trim() : "";

    if (mode === "employee" && !employeeCode) {
      return NextResponse.json(
        { message: "employeeCode is required when mode is employee" },
        { status: 400 }
      );
    }

    await connectDB();

    const byFaculty = await dutySlotsByFacultyId();

    let rows: FacultyReportRow[] = [];
    let fileNameBase: string;
    let sheetTitle: string;

    if (mode === "employee") {
      const faculty = await Faculty.findOne({
        employeeCode,
      }).lean<LeanFaculty | null>();

      if (!faculty) {
        return NextResponse.json(
          { message: "Faculty not found" },
          { status: 404 }
        );
      }

      const id = String(faculty._id);
      const duties = byFaculty.get(id) ?? [];
      rows = [facultyToRow(faculty, duties)];
      fileNameBase = `FacultyDutyReport_${employeeCode}`;
      sheetTitle = `Faculty duty report — ${employeeCode}`;
    } else {
      const faculties = await Faculty.find({})
        .sort({ employeeCode: 1 })
        .lean<LeanFaculty[]>();

      rows = faculties.map((f) =>
        facultyToRow(f, byFaculty.get(String(f._id)) ?? [])
      );
      fileNameBase = "FacultyDutyReport_all";
      sheetTitle = "Faculty duty report — all";
    }

    const { buffer, fileName } = await buildFacultyReportExcel(rows, {
      sheetTitle,
      fileNameBase,
    });

    const dayStamp = new Date().toISOString().slice(0, 10);
    const safeName = `${fileName}_${dayStamp}`.replace(/[<>:"/\\|?*]/g, "_");
    const encodedName = encodeURIComponent(safeName + ".xlsx");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"; filename*=UTF-8''${encodedName}`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
