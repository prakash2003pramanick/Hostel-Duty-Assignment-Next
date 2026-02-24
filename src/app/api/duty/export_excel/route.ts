import { NextRequest, NextResponse } from "next/server";
import { convertAssignmentsToExcel } from "@/lib/utils/convertAssignmentsToExcel";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignments, startDate, endDate, gender } = body;

    if (!assignments || !Array.isArray(assignments)) {
      return NextResponse.json(
        { message: "assignments array is required" },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { message: "startDate and endDate are required for the filename" },
        { status: 400 }
      );
    }

    const { buffer, fileName } = await convertAssignmentsToExcel(assignments, {
      startDate,
      endDate,
      gender,
    });

    const safeName = (fileName || "Duty").replace(/[<>:"/\\|?*]/g, "_");
    const encodedName = encodeURIComponent(safeName + ".xlsx");

    return new NextResponse(buffer, {
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
