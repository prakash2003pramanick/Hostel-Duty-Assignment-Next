import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Faculty from "@/lib/models/Faculty";
import DutyAssignment from "@/lib/models/DutyAssignment";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ empCode: string }> }
) {
  try {
    const { empCode } = await params;

    if (!empCode) {
      return NextResponse.json(
        { message: "Employee code is required" },
        { status: 400 }
      );
    }

    await connectDB();

    const faculty = await Faculty.findOne({
      employeeCode: empCode,
    }).lean();

    if (!faculty) {
      return NextResponse.json(
        { message: "Faculty not found" },
        { status: 404 }
      );
    }

    type FacultyDoc = {
      _id: unknown;
      name?: string;
      title?: string;
      employeeCode?: string;
      designation?: string;
      orgUnit?: string;
      officialEmail?: string;
      personalEmail?: string;
      mobile?: string;
    };
    const f = faculty as FacultyDoc;
    const facultyId = f._id;
    const dutyDocs = await DutyAssignment.find({
      $or: [
        { "faculty1.employeeCode": empCode },
        { "faculty2.employeeCode": empCode },
        { "faculty1.id": facultyId },
        { "faculty2.id": facultyId },
      ],
    })
      .sort({ date: 1 })
      .populate("faculty1.id", "name title employeeCode designation orgUnit officialEmail personalEmail mobile")
      .populate("faculty2.id", "name title employeeCode designation orgUnit officialEmail personalEmail mobile")
      .lean();

    const buildFacultyInfo = (
      rawFaculty:
        | {
            id?: Record<string, unknown> | unknown;
            employeeCode?: string;
            name?: string;
            employeeGroup?: string;
          }
        | undefined
    ) => {
      if (!rawFaculty) return null;
      const populated =
        rawFaculty.id && typeof rawFaculty.id === "object"
          ? (rawFaculty.id as Record<string, unknown>)
          : null;

      if (populated) {
        return {
          _id: populated._id,
          name: (populated.name as string) || rawFaculty.name || "",
          title: (populated.title as string) || "",
          employeeCode:
            (populated.employeeCode as string) ||
            rawFaculty.employeeCode ||
            "",
          designation: (populated.designation as string) || "",
          orgUnit: (populated.orgUnit as string) || "",
          officialEmail: (populated.officialEmail as string) || "",
          personalEmail: (populated.personalEmail as string) || "",
          mobile: (populated.mobile as string) || "",
        };
      }

      if (rawFaculty.name || rawFaculty.employeeCode) {
        return {
          _id: rawFaculty.id ?? null,
          name: rawFaculty.name || "",
          title: "",
          employeeCode: rawFaculty.employeeCode || "",
          designation: "",
          orgUnit: "",
          officialEmail: "",
          personalEmail: "",
          mobile: "",
        };
      }

      return null;
    };

    const history = dutyDocs.map((doc: Record<string, unknown>) => {
      const f1 = buildFacultyInfo(
        doc.faculty1 as
          | {
              id?: Record<string, unknown> | unknown;
              employeeCode?: string;
              name?: string;
              employeeGroup?: string;
            }
          | undefined
      );
      const f2 = buildFacultyInfo(
        doc.faculty2 as
          | {
              id?: Record<string, unknown> | unknown;
              employeeCode?: string;
              name?: string;
              employeeGroup?: string;
            }
          | undefined
      );

      const facultyList = [f1, f2].filter(Boolean);
      const matchedIdx = facultyList.findIndex(
        (f) =>
          f &&
          (String(f.employeeCode || "").trim().toLowerCase() ===
            empCode.toLowerCase() ||
            (facultyId && String(f._id) === String(facultyId)))
      );
      const matched = matchedIdx >= 0 ? facultyList[matchedIdx] : null;
      const others = facultyList.filter((_, i) => i !== matchedIdx);
      const orderedFaculty = matched ? [matched, ...others] : facultyList;

      return {
        _id: doc._id,
        date: doc.date,
        hostel: doc.hostel,
        group: doc.group,
        roomRange: doc.roomRange,
        startRoom: doc.startRoom,
        endRoom: doc.endRoom,
        faculty: orderedFaculty,
      };
    });

    return NextResponse.json({
      message: "Faculty found",
      faculty: {
        _id: facultyId,
        name: f.name,
        title: f.title || "",
        employeeCode: f.employeeCode,
        designation: f.designation || "",
        orgUnit: f.orgUnit || "",
        officialEmail: f.officialEmail || "",
        personalEmail: f.personalEmail || "",
        mobile: f.mobile || "",
      },
      history,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
