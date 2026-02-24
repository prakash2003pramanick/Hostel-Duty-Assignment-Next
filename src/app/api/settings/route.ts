import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Setting from "@/lib/models/Setting";

export async function GET() {
  try {
    await connectDB();

    const settings = await Setting.findOne();

    if (!settings) {
      return NextResponse.json(
        { message: "Settings not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: "Settings retrieved successfully",
      settings,
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

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    let { boysHostel, girlsHostel } = body;

    boysHostel = parseInt(boysHostel, 10);
    girlsHostel = parseInt(girlsHostel, 10);

    if (isNaN(boysHostel) || isNaN(girlsHostel)) {
      return NextResponse.json(
        { message: "Invalid input" },
        { status: 400 }
      );
    }

    await connectDB();

    const settings = await Setting.findOne();

    if (!settings) {
      const newSettings = await Setting.create({ boysHostel, girlsHostel });
      return NextResponse.json(
        {
          message: "Settings created successfully",
          settings: newSettings,
        },
        { status: 201 }
      );
    }

    settings.boysHostel = boysHostel;
    settings.girlsHostel = girlsHostel;
    await settings.save();

    return NextResponse.json({
      message: "Settings updated successfully",
      settings,
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
