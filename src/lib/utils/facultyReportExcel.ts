import ExcelJS from "exceljs";

/** One calendar day of duty; multiple hostels that day are merged into `parts`. */
export type DutySlot = {
  date: Date;
  parts: { hostel: string; roomRange: string }[];
};

export type FacultyReportRow = {
  employeeCode: string;
  title: string;
  name: string;
  designation: string;
  orgUnit: string;
  officialEmail: string;
  personalEmail: string;
  mobile: string;
  employeeGroup: string;
  gender: string;
  duties: DutySlot[];
};

const formatDutyDateUTC = (d: Date) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const dutyCellText = (d: DutySlot) => {
  const inner = d.parts
    .map((p) => `${p.hostel || "-"} (${p.roomRange || "-"})`)
    .join(", ");
  return `${formatDutyDateUTC(d.date)} [ ${inner} ]`;
};

export async function buildFacultyReportExcel(
  rows: FacultyReportRow[],
  options: { sheetTitle: string; fileNameBase: string }
): Promise<{ buffer: Buffer; fileName: string }> {
  const maxDuties = rows.reduce((m, r) => Math.max(m, r.duties.length), 0);

  const baseHeaders = [
    "Employee code",
    "Title",
    "Name",
    "Designation",
    "Org unit",
    "Official email",
    "Personal email",
    "Mobile",
    "Employee group",
    "Gender",
    "Total duties",
  ];
  const dutyHeaders = Array.from({ length: maxDuties }, (_, i) => `Duty ${i + 1}`);
  const headers = [...baseHeaders, ...dutyHeaders];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hostel Duty Assignment";
  const sheet = workbook.addWorksheet("Faculty report", {
    headerFooter: { firstHeader: options.sheetTitle },
  });

  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };
  });

  for (const row of rows) {
    const total = row.duties.length;
    const dutyCells: string[] = row.duties.map(dutyCellText);
    while (dutyCells.length < maxDuties) dutyCells.push("");

    const dataRow = sheet.addRow([
      row.employeeCode,
      row.title,
      row.name,
      row.designation,
      row.orgUnit,
      row.officialEmail,
      row.personalEmail,
      row.mobile,
      row.employeeGroup,
      row.gender,
      total,
      ...dutyCells,
    ]);
    dataRow.eachCell((cell) => {
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  }

  sheet.columns.forEach((col) => {
    if (!col?.eachCell) return;
    let maxLen = 10;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value != null ? String(cell.value) : "";
      maxLen = Math.max(maxLen, Math.min(v.length, 60));
    });
    col.width = Math.min(maxLen + 2, 55);
  });

  const buf = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
  const safe = options.fileNameBase.replace(/[<>:"/\\|?*]/g, "_");
  return { buffer, fileName: safe };
}
