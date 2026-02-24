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

    const dutyDocs = await DutyAssignment.find({
      $or: [
        { "faculty1.id": faculty._id },
        { "faculty2.id": faculty._id },
      ],
    })
      .sort({ date: 1 })
      .populate("faculty1.id", "name title employeeCode designation orgUnit officialEmail personalEmail mobile")
      .populate("faculty2.id", "name title employeeCode designation orgUnit officialEmail personalEmail mobile")
      .lean();

    const history = dutyDocs.map((doc: Record<string, unknown>) => {
      const f1 = (doc.faculty1 as { id?: Record<string, unknown> })?.id
        ? {
            _id: (doc.faculty1 as { id: { _id: unknown } }).id._id,
            name: (doc.faculty1 as { id: { name?: string } }).id.name,
            title: (doc.faculty1 as { id: { title?: string } }).id.title || "",
            employeeCode: (doc.faculty1 as { id: { employeeCode?: string } })
              .id.employeeCode,
            designation:
              (doc.faculty1 as { id: { designation?: string } }).id
                .designation || "",
            orgUnit:
              (doc.faculty1 as { id: { orgUnit?: string } }).id.orgUnit || "",
            officialEmail:
              (doc.faculty1 as { id: { officialEmail?: string } }).id
                .officialEmail || "",
            personalEmail:
              (doc.faculty1 as { id: { personalEmail?: string } }).id
                .personalEmail || "",
            mobile:
              (doc.faculty1 as { id: { mobile?: string } }).id.mobile || "",
          }
        : null;
      const f2 = (doc.faculty2 as { id?: Record<string, unknown> })?.id
        ? {
            _id: (doc.faculty2 as { id: { _id: unknown } }).id._id,
            name: (doc.faculty2 as { id: { name?: string } }).id.name,
            title: (doc.faculty2 as { id: { title?: string } }).id.title || "",
            employeeCode: (doc.faculty2 as { id: { employeeCode?: string } })
              .id.employeeCode,
            designation:
              (doc.faculty2 as { id: { designation?: string } }).id
                .designation || "",
            orgUnit:
              (doc.faculty2 as { id: { orgUnit?: string } }).id.orgUnit || "",
            officialEmail:
              (doc.faculty2 as { id: { officialEmail?: string } }).id
                .officialEmail || "",
            personalEmail:
              (doc.faculty2 as { id: { personalEmail?: string } }).id
                .personalEmail || "",
            mobile:
              (doc.faculty2 as { id: { mobile?: string } }).id.mobile || "",
          }
        : null;

      const facultyList = [f1, f2].filter(Boolean);
      const matchedIdx = facultyList.findIndex(
        (f) => f && String((f as { _id: unknown })._id) === String(faculty._id)
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
        _id: faculty._id,
        name: faculty.name,
        title: faculty.title || "",
        employeeCode: faculty.employeeCode,
        designation: faculty.designation || "",
        orgUnit: faculty.orgUnit || "",
        officialEmail: faculty.officialEmail || "",
        personalEmail: faculty.personalEmail || "",
        mobile: faculty.mobile || "",
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
