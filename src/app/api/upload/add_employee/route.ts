import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import connectDB from "@/lib/db";
import Faculty from "@/lib/models/Faculty";

const cleanHeader = (key: string) =>
  (key || "")
    .toString()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

const COLUMN_MAP: Record<string, string> = {
  employeecode: "employeeCode",
  empcode: "employeeCode",
  employeename: "name",
  name: "name",
  title: "title",
  designation: "designation",
  orgunit: "orgUnit",
  department: "orgUnit",
  employeegroup: "employeeGroup",
  type: "employeeGroup",
  gender: "gender",
  personalemailid: "personalEmail",
  personalemail: "personalEmail",
  emailid: "personalEmail",
  officialemailid: "officialEmail",
  officialemail: "officialEmail",
  mobile: "mobile",
  mobno: "mobile",
};

interface RawRow {
  [key: string]: unknown;
}

const parseRowToFaculty = (row: RawRow) => {
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return "";
  };

  const empCode = get([
    "employeecode",
    "empcode",
    "EmployeeCode",
    "EmpCode",
  ]);
  const name = get(["employeename", "name", "EmployeeName", "Name"]);

  if (!empCode || !name) return null;

  return {
    employeeCode: String(empCode).trim(),
    title: String(get(["title", "Title"]) || "").trim(),
    name: String(name).trim(),
    designation: String(get(["designation", "Designation"]) || "").trim(),
    orgUnit: String(get(["orgunit", "department", "OrgUnit", "Department"]) || "").trim(),
    employeeGroup: String(get(["employeegroup", "type", "EmployeeGroup", "Type"]) || "").trim(),
    gender: String(get(["gender", "Gender"]) || "MALE").trim(),
    personalEmail: String(
      get([
        "personalemailid",
        "personalemail",
        "emailid",
        "PersonalEmailid",
        "EmailID",
      ]) || ""
    ).trim(),
    officialEmail: String(
      get([
        "officialemailid",
        "officialemail",
        "OFFICIALEmailid",
        "OfficialEmail",
      ]) || ""
    ).trim(),
    mobile: get(["mobile", "mobno", "Mobile", "MobNo"])
      ? String(get(["mobile", "mobno", "Mobile", "MobNo"])).trim()
      : "",
  };
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("excelFile") as File | null;

    if (!file) {
      return NextResponse.json(
        { message: "No file uploaded" },
        { status: 400 }
      );
    }

    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { message: "Only Excel files are allowed" },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const allData: {
      employeeCode: string;
      title: string;
      name: string;
      designation: string;
      orgUnit: string;
      employeeGroup: string;
      gender: string;
      personalEmail: string;
      officialEmail: string;
      mobile: string;
    }[] = [];
    const allStatus: { [key: string]: unknown; sheet: string; status: string }[] =
      [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
      }) as unknown[][];

      if (!rawData.length) continue;

      const headers = rawData[0] as string[];
      const dataRows = rawData.slice(1);

      const cleanHeaders = headers.map((h) => cleanHeader(h));
      const rowToObj = (row: unknown[]) => {
        const obj: RawRow = {};
        cleanHeaders.forEach((key, i) => {
          obj[key] = row[i];
        });
        return obj;
      };

      const mappedRows = dataRows.map((row) => {
        const obj: RawRow = {};
        cleanHeaders.forEach((key, i) => {
          const modelKey = COLUMN_MAP[key] || key;
          obj[modelKey] = row[i];
        });
        obj._raw = rowToObj(row);
        return obj;
      });

      for (const row of mappedRows) {
        const faculty = parseRowToFaculty((row._raw || row) as RawRow);
        if (!faculty) {
          allStatus.push({
            ...(row._raw || row),
            sheet: sheetName,
            status: "Skipped: Missing Employee Code or Name",
          } as { [key: string]: unknown; sheet: string; status: string });
          continue;
        }

        allData.push(faculty);
        allStatus.push({
          ...(row._raw || row),
          sheet: sheetName,
          status: "Processed (Inserted or Updated)",
        } as { [key: string]: unknown; sheet: string; status: string });
      }
    }

    const uniqueByCode = new Map<string, (typeof allData)[0]>();
    for (const f of allData) {
      uniqueByCode.set(f.employeeCode, f);
    }
    const uniqueFaculty = [...uniqueByCode.values()];

    await connectDB();

    const bulkOperations = uniqueFaculty.map((doc) => ({
      updateOne: {
        filter: { employeeCode: doc.employeeCode },
        update: {
          $set: doc,
          $setOnInsert: { lastDuty: {}, lastWeekEndDuty: {} },
        },
        upsert: true,
      },
    }));

    if (bulkOperations.length > 0) {
      await Faculty.bulkWrite(bulkOperations as never[]);
    }

    const newSheet = XLSX.utils.json_to_sheet(allStatus);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Status");

    const excelBuffer = XLSX.write(newWorkbook, {
      bookType: "xlsx",
      type: "buffer",
    }) as Buffer;

    const safeName = `processed_${Date.now()}.xlsx`;
    const encodedName = encodeURIComponent(safeName);

    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      {
        message: "Bulk operation failed",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
