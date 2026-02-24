import ExcelJS from "exceljs";

/**
 * Format a date as DD.MM.YY (e.g. 02.01.26)
 */
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
};

/**
 * Parse YYYY-MM-DD or similar to avoid timezone issues
 */
const parseDateForFilename = (
  str: string | null | undefined
): { year: number; month: number; day: number } | null => {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m)
    return {
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10) - 1,
      day: parseInt(m[3], 10),
    };
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate(),
  };
};

/**
 * Format date range for filename (e.g. "1st Jan-31 Jan")
 */
export const formatDateRangeForFilename = (
  startDate: string,
  endDate: string
) => {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const ord = (n: number) => {
    if (n >= 11 && n <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  };
  const s = parseDateForFilename(startDate);
  const e = parseDateForFilename(endDate);
  if (!s || !e) return "Duty";
  return `${ord(s.day)} ${months[s.month]}-${e.day} ${months[e.month]}`;
};

interface FacultyAssignment {
  employeeCode?: string;
  title?: string;
  facultyName?: string;
  name?: string;
  designation?: string;
  orgUnit?: string;
  employeeGroup?: string;
  gender?: string;
  personalEmail?: string;
  officialEmail?: string;
  hostel?: string;
  roomRange?: string;
}

interface AssignmentItem {
  date: string;
  facultyAssignments?: FacultyAssignment[];
}

interface GroupAssignments {
  groupName?: string;
  assignments?: AssignmentItem[];
}

interface RowData {
  _blankBeforeDate?: boolean;
  date?: string;
  hostel?: string;
  room?: string;
  employeeCode?: string;
  title?: string;
  employeeName?: string;
  designation?: string;
  orgUnit?: string;
  employeeGroup?: string;
  gender?: string;
  personalEmail?: string;
  officialEmail?: string;
}

/**
 * Build rows for a group's assignments.
 * Groups by date -> hostel -> room range. Date and Hostel span multiple rows.
 */
const buildRowsForGroup = (group: GroupAssignments): RowData[] => {
  const rows: RowData[] = [];
  const assignments = group.assignments || [];

  const byDate = new Map<string, FacultyAssignment[]>();
  for (const a of assignments) {
    const key = a.date;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(...(a.facultyAssignments || []));
  }

  const sortedDates = [...byDate.keys()].sort();

  for (let dateIdx = 0; dateIdx < sortedDates.length; dateIdx++) {
    const dateStr = sortedDates[dateIdx];
    const items = byDate.get(dateStr)!;

    if (dateIdx > 0) {
      rows.push({ _blankBeforeDate: true });
    }

    const byHostel = new Map<string, FacultyAssignment[]>();
    for (const item of items) {
      const h = item.hostel || "";
      if (!byHostel.has(h)) byHostel.set(h, []);
      byHostel.get(h)!.push(item);
    }

    const sortedHostels = [...byHostel.keys()].filter(Boolean);

    let isFirstRowForDate = true;

    for (const hostel of sortedHostels) {
      const hostelItems = byHostel.get(hostel)!;
      const byRoom = new Map<string, FacultyAssignment[]>();
      for (const item of hostelItems) {
        const r = item.roomRange || "";
        if (!byRoom.has(r)) byRoom.set(r, []);
        byRoom.get(r)!.push(item);
      }

      const sortedRooms = [...byRoom.keys()].filter(Boolean);
      let isFirstRowForHostel = true;

      for (const roomRange of sortedRooms) {
        const facultyList = byRoom.get(roomRange)!;
        let isFirstRowForRoom = true;

        for (const f of facultyList) {
          rows.push({
            date:
              isFirstRowForDate && isFirstRowForHostel && isFirstRowForRoom
                ? formatDate(dateStr)
                : "",
            hostel: isFirstRowForHostel && isFirstRowForRoom ? hostel : "",
            room: isFirstRowForRoom ? roomRange : "",
            employeeCode: f.employeeCode || "",
            title: f.title || "",
            employeeName: f.facultyName || f.name || "",
            designation: f.designation || "",
            orgUnit: f.orgUnit || "",
            employeeGroup: f.employeeGroup || "",
            gender: f.gender || "",
            personalEmail: f.personalEmail || "",
            officialEmail: f.officialEmail || "",
          });
          isFirstRowForRoom = false;
          isFirstRowForDate = false;
          isFirstRowForHostel = false;
        }
      }
    }
  }

  return rows;
};

export interface ConvertOptions {
  startDate?: string;
  endDate?: string;
  gender?: string;
}

/**
 * Generate Excel from assignments JSON.
 *
 * @param assignmentsResponse - The response from assignDuties API
 * @param options - Optional startDate, endDate, gender for filename
 * @returns Promise<{ buffer: Buffer; fileName: string }>
 */
export const convertAssignmentsToExcel = async (
  assignmentsResponse: GroupAssignments[],
  options: ConvertOptions = {}
): Promise<{ buffer: Buffer; fileName: string }> => {
  const groups = Array.isArray(assignmentsResponse) ? assignmentsResponse : [];

  const startDate = options.startDate;
  const endDate = options.endDate;
  const gender = (options.gender || "Hostel").replace(/\s+/g, " ").trim();

  const dateRangeStr =
    startDate && endDate
      ? formatDateRangeForFilename(startDate, endDate)
      : "Duty";
  const fileName = `${dateRangeStr} ${gender} Hostel Duty`;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Hostel Duty Assignment";

  const HEADERS = [
    "Date",
    "Hostel",
    "Room",
    "Employee Code",
    "Title",
    "Employee Name",
    "Designation",
    "Org Unit",
    "Employee Group",
    "Gender",
    "Personal Email",
    "Official Email",
  ];

  for (const group of groups) {
    const sheetName = (group.groupName || "Group").substring(0, 31);
    const sheet = workbook.addWorksheet(sheetName, {
      headerFooter: { firstHeader: fileName },
    });

    const headerRow = sheet.addRow(HEADERS);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    const rows = buildRowsForGroup(group);
    for (const r of rows) {
      if (r._blankBeforeDate) {
        sheet.addRow([]);
        continue;
      }
      const row = sheet.addRow([
        r.date,
        r.hostel,
        r.room,
        r.employeeCode,
        r.title,
        r.employeeName,
        r.designation,
        r.orgUnit,
        r.employeeGroup,
        r.gender,
        r.personalEmail,
        r.officialEmail,
      ]);
      row.eachCell((cell) => {
        cell.alignment = { vertical: "middle" };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    }

    sheet.columns.forEach((col, i) => {
      let maxLen = 12;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value ? String(cell.value) : "";
        maxLen = Math.max(maxLen, Math.min(v.length, 50));
      });
      col.width = Math.min(maxLen + 2, 50);
    });
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
  return { buffer, fileName };
};
