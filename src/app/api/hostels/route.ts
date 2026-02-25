import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Hostel from "@/lib/models/Hostel";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const filter = type ? { type: new RegExp(`^${type}$`, "i") } : {};
    const hostels = await Hostel.find(filter).sort({ name: 1 }).lean();
    return NextResponse.json({ hostels });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
