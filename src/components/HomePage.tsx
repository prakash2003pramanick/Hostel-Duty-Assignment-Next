"use client";

import { useState } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

export default function HomePage() {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [hostelType, setHostelType] = useState<"BOY'S" | "GIRL'S">("BOY'S");

  const formatDateToYMD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const handleGenerateDuty = async () => {
    if (!startDate || !endDate) {
      alert("Please fill all fields.");
      return;
    }

    const dutyData = {
      startDate: formatDateToYMD(startDate),
      endDate: formatDateToYMD(endDate),
      gender: hostelType === "BOY'S" ? "MALE" : "FEMALE",
    };

    try {
      const assignRes = await fetch("/api/duty/assign_duty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dutyData),
      });

      if (!assignRes.ok) {
        const errData = await assignRes.json().catch(() => ({}));
        throw new Error(
          errData.message || errData.error || "Failed to assign duties"
        );
      }

      const assignments = await assignRes.json();
      if (
        !assignments ||
        !Array.isArray(assignments) ||
        assignments.length === 0
      ) {
        alert(
          "No assignments generated. Check if you have sufficient data (hostels, groups, faculty)."
        );
        return;
      }

      const exportRes = await fetch("/api/duty/export_excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignments,
          startDate: dutyData.startDate,
          endDate: dutyData.endDate,
          gender: dutyData.gender,
        }),
      });

      if (!exportRes.ok) throw new Error("Failed to export Excel");

      const blob = await exportRes.blob();
      const url = window.URL.createObjectURL(blob);
      const contentDisposition = exportRes.headers.get("Content-Disposition");
      let filename = `DutySheet_${dutyData.startDate}_to_${dutyData.endDate}.xlsx`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (match) filename = match[1].trim();
      }

      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error ? error.message : "Error generating duty file"
      );
    }
  };

  return (
    <div className="container">
      <h1>Duty Assignment System</h1>

      <div className="form-row">
        <div className="form-group half-width">
          <label>Start Date</label>
          <DatePicker
            selected={startDate}
            onChange={(date) => setStartDate(date)}
            dateFormat="yyyy-MM-dd"
            className="custom-select"
            placeholderText="Select Start Date"
          />
        </div>

        <div className="form-group half-width">
          <label>End Date</label>
          <DatePicker
            selected={endDate}
            onChange={(date) => setEndDate(date)}
            dateFormat="yyyy-MM-dd"
            className="custom-select"
            placeholderText="Select End Date"
            minDate={startDate ?? undefined}
          />
        </div>

        <div className="form-group half-width">
          <label>Type</label>
          <select
            value={hostelType}
            onChange={(e) =>
              setHostelType(e.target.value as "BOY'S" | "GIRL'S")
            }
            className="custom-select"
          >
            <option value="BOY'S">BOY&apos;S</option>
            <option value="GIRL'S">GIRL&apos;S</option>
          </select>
        </div>
      </div>

      <div className="button-group">
        <button onClick={handleGenerateDuty} className="generate-btn">
          Generate Duty
        </button>
      </div>
    </div>
  );
}
