import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Group from "@/lib/models/Group";
import Hostel from "@/lib/models/Hostel";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const requests = Array.isArray(body) ? body : [body];
    const allHostelsInRequests = [
      ...new Set(requests.flatMap((r: { hostelName?: string[] }) => r.hostelName || [])),
    ];

    await connectDB();

    const existingHostels = await Hostel.find({
      name: { $in: allHostelsInRequests },
    }).lean();
    const existingHostelsSet = new Set(existingHostels.map((h) => h.name));

    const operations: unknown[] = [];
    const responseGroups: { name?: string; error?: string; deleted?: boolean; updated?: boolean; upserted?: boolean }[] = [];

    for (const req of requests) {
      const {
        name,
        hostelName = [],
        numberOfFacutlyPerDay,
        type,
        school,
        delete: deleteFlag,
        replaceHostels = false,
      } = req;

      if (!name) {
        responseGroups.push({ error: "Group name is required." });
        continue;
      }

      const invalidHostels = hostelName.filter((h: string) => !existingHostelsSet.has(h));
      if (invalidHostels.length > 0) {
        responseGroups.push({
          name,
          error: `Invalid hostel(s): ${invalidHostels.join(", ")}`,
        });
        continue;
      }

      const existingGroup = await Group.findOne({ name }).lean();

      if (deleteFlag && existingGroup) {
        const updatedHostels = (existingGroup.hostelName || []).filter(
          (h: string) => !hostelName.includes(h)
        );
        if (updatedHostels.length === 0) {
          operations.push({
            deleteOne: { filter: { _id: existingGroup._id } },
          });
          responseGroups.push({ name, deleted: true });
        } else {
          operations.push({
            updateOne: {
              filter: { _id: existingGroup._id },
              update: { $set: { hostelName: updatedHostels } },
            },
          });
          responseGroups.push({ name, updated: true });
        }
        continue;
      }

      let finalHostelNames: string[];
      if (replaceHostels || !existingGroup) {
        finalHostelNames = hostelName;
      } else {
        finalHostelNames = Array.from(
          new Set([...(existingGroup.hostelName || []), ...hostelName])
        );
      }

      const updateFields: Record<string, unknown> = {
        name,
        hostelName: finalHostelNames,
        numberOfFacutlyPerDay,
        type,
      };
      if (school !== undefined) updateFields.school = school;

      operations.push({
        updateOne: {
          filter: { name },
          update: { $set: updateFields },
          upsert: true,
        },
      });
      responseGroups.push({ name, upserted: true });
    }

    if (operations.length > 0) {
      await Group.bulkWrite(operations as never[]);
    }

    return NextResponse.json({
      message: "Group(s) processed successfully.",
      groups: responseGroups,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
