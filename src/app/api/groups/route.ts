import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Group from "@/lib/models/Group";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");
    const filter = type ? { type: new RegExp(`^${type}$`, "i") } : {};
    const groups = await Group.find(filter).sort({ name: 1 }).lean();
    return NextResponse.json({ groups });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
