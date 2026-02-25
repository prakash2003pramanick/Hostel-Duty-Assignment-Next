import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Faculty from "@/lib/models/Faculty";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const gender = searchParams.get("gender");
    const filter = gender
      ? { gender: new RegExp(`^${gender}$`, "i"), orgUnit: { $exists: true, $ne: "" } }
      : { orgUnit: { $exists: true, $ne: "" } };
    const schools = await Faculty.distinct("orgUnit", filter);
    const sorted = (schools as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ schools: sorted });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
