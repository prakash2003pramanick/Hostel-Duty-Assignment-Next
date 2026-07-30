import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import connectDB from "@/lib/db";
import Faculty from "@/lib/models/Faculty";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const EXCEL_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const cleanHeader = (value: unknown) =>
  String(value ?? "")
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

const isExcelFile = (file: File) => {
  const allowedTypes = new Set([
    EXCEL_CONTENT_TYPE,
    "application/vnd.ms-excel",
    "application/octet-stream",
  ]);
  const hasExcelExtension = /\.(xlsx|xls)$/i.test(file.name);

  return hasExcelExtension && (!file.type || allowedTypes.has(file.type));
};

const getDownloadName = (originalName: string) => {
  const baseName = originalName.replace(/\.(xlsx|xls)$/i, "");
  const safeBaseName =
    baseName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "employees";

  return `delete_status_${safeBaseName}.xlsx`;
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("excelFile");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { message: "No Excel file uploaded" },
        { status: 400 }
      );
    }

    if (!isExcelFile(file)) {
      return NextResponse.json(
        { message: "Only .xlsx or .xls Excel files are allowed" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { message: "Excel file must be 10 MB or smaller" },
        { status: 400 }
      );
    }

    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), {
      type: "buffer",
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;

    if (!worksheet?.["!ref"]) {
      return NextResponse.json(
        { message: "The Excel file does not contain a non-empty sheet" },
        { status: 400 }
      );
    }

    const range = XLSX.utils.decode_range(worksheet["!ref"]);
    let employeeCodeColumn = -1;

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const headerCell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
      const header = cleanHeader(headerCell?.v);

      if (header === "empcode" || header === "employeecode") {
        employeeCodeColumn = column;
        break;
      }
    }

    if (employeeCodeColumn === -1) {
      return NextResponse.json(
        { message: 'The first sheet must contain an "Emp. Code" column' },
        { status: 400 }
      );
    }

    const statusColumn = range.e.c + 1;
    XLSX.utils.sheet_add_aoa(worksheet, [["Status"]], {
      origin: { r: range.s.r, c: statusColumn },
    });

    await connectDB();

    let deletedCount = 0;
    let notFoundCount = 0;

    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const codeCell =
        worksheet[XLSX.utils.encode_cell({ r: row, c: employeeCodeColumn })];
      const employeeCode = String(codeCell?.w ?? codeCell?.v ?? "").trim();
      let status = "Employee code not found";

      if (employeeCode) {
        const result = await Faculty.deleteOne({ employeeCode });
        if (result.deletedCount === 1) {
          status = "Deleted";
          deletedCount += 1;
        } else {
          notFoundCount += 1;
        }
      } else {
        notFoundCount += 1;
      }

      XLSX.utils.sheet_add_aoa(worksheet, [[status]], {
        origin: { r: row, c: statusColumn },
      });
    }

    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    }) as Buffer;
    const downloadName = getDownloadName(file.name);
    const encodedName = encodeURIComponent(downloadName);

    console.info(
      JSON.stringify({
        event: "employee_bulk_delete_completed",
        deletedCount,
        notFoundCount,
      })
    );

    return new NextResponse(new Uint8Array(excelBuffer), {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${downloadName}"; filename*=UTF-8''${encodedName}`,
        "Content-Type": EXCEL_CONTENT_TYPE,
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "employee_bulk_delete_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );

    return NextResponse.json(
      { message: "Employee deletion failed" },
      { status: 500 }
    );
  }
}
