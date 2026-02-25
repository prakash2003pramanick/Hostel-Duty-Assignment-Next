import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/db";
import Hostel from "@/lib/models/Hostel";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const requests = Array.isArray(body) ? body : [body];
    const hostelsInRequest = requests.map((r: { name: string }) => r.name);

    await connectDB();

    const existingHostels = await Hostel.find({
      name: { $in: hostelsInRequest },
    }).lean();
    const existingHostelsMap = new Map(
      existingHostels.map((h) => [h.name, h])
    );

    const operations: unknown[] = [];
    const responseHostels: { name: string; deleted?: boolean; upserted?: boolean }[] = [];

    for (const req of requests) {
      const {
        name,
        type,
        capacity,
        numberOfRooms,
        associatedSchools = [],
        nonAssociatedSchools = [],
        removeAssociatedSchools = [],
        removeNonAssociatedSchools = [],
        replaceSchools = false,
        delete: deleteFlag,
      } = req;

      const existingHostel = existingHostelsMap.get(name);

      if (deleteFlag && existingHostel) {
        operations.push({
          deleteOne: { filter: { _id: existingHostel._id } },
        });
        responseHostels.push({ name, deleted: true });
        continue;
      }

      let finalAssociated = associatedSchools;
      let finalNonAssociated = nonAssociatedSchools;

      if (existingHostel && !replaceSchools) {
        finalAssociated = Array.from(
          new Set([
            ...(existingHostel.associatedSchools || []),
            ...associatedSchools,
          ])
        ).filter((s) => !removeAssociatedSchools.includes(s));
        finalNonAssociated = Array.from(
          new Set([
            ...(existingHostel.nonAssociatedSchools || []),
            ...nonAssociatedSchools,
          ])
        ).filter((s) => !removeNonAssociatedSchools.includes(s));
      }

      operations.push({
        updateOne: {
          filter: { name },
          update: {
            $set: {
              name,
              type,
              capacity,
              numberOfRooms,
              associatedSchools: finalAssociated,
              nonAssociatedSchools: finalNonAssociated,
            },
          },
          upsert: true,
        },
      });
      responseHostels.push({ name, upserted: true });
    }

    if (operations.length > 0) {
      await Hostel.bulkWrite(operations as never[]);
    }

    return NextResponse.json({
      message: "Hostel(s) processed successfully.",
      hostels: responseHostels,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
