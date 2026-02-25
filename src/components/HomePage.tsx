"use client";

import { useState, useEffect } from "react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

interface OptionItem {
  _id: string;
  name: string;
}

export default function HomePage() {
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [hostelType, setHostelType] = useState<"BOY'S" | "GIRL'S">("BOY'S");
  const [startFromWhereLeft, setStartFromWhereLeft] = useState<boolean>(false);
  const [allowDuplicateEntries, setAllowDuplicateEntries] =
    useState<boolean>(false);
  const [excludedGroups, setExcludedGroups] = useState<string[]>([]);
  const [excludedSchools, setExcludedSchools] = useState<string[]>([]);
  const [excludedHostels, setExcludedHostels] = useState<string[]>([]);

  const [groups, setGroups] = useState<OptionItem[]>([]);
  const [schools, setSchools] = useState<string[]>([]);
  const [hostels, setHostels] = useState<OptionItem[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [excludeConfigExpanded, setExcludeConfigExpanded] = useState(false);
  const [generatingDuty, setGeneratingDuty] = useState(false);

  const gender = hostelType === "BOY'S" ? "MALE" : "FEMALE";
  const typeParam = hostelType === "BOY'S" ? "BOYS" : "GIRLS";

  useEffect(() => {
    const fetchOptions = async () => {
      setLoadingOptions(true);
      try {
        const [groupsRes, hostelsRes, schoolsRes] = await Promise.all([
          fetch(`/api/groups?type=${typeParam}`),
          fetch(`/api/hostels?type=${typeParam}`),
          fetch(`/api/schools?gender=${gender}`),
        ]);

        const groupsData = await groupsRes.json();
        const hostelsData = await hostelsRes.json();
        const schoolsData = await schoolsRes.json();

        if (groupsRes.ok) setGroups(groupsData.groups || []);
        if (hostelsRes.ok) setHostels(hostelsData.hostels || []);
        if (schoolsRes.ok) setSchools(schoolsData.schools || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingOptions(false);
      }
    };
    fetchOptions();
  }, [hostelType, typeParam, gender]);

  const formatDateToYMD = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const toggleExcluded = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    value: string
  ) => {
    setter((prev) =>
      prev.includes(value) ? prev.filter((x) => x !== value) : [...prev, value]
    );
  };

  const handleGenerateDuty = async () => {
    if (!startDate || !endDate) {
      alert("Please fill all fields.");
      return;
    }

    const dutyData = {
      startDate: formatDateToYMD(startDate),
      endDate: formatDateToYMD(endDate),
      gender,
      excludedGroups,
      excludedSchools,
      excludedHostels,
      startFromWhereLeft,
      allowDuplicateEntries,
    };

    setGeneratingDuty(true);
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
    } finally {
      setGeneratingDuty(false);
    }
  };

  return (
    <div className="container container-relative">
      {generatingDuty && (
        <div className="page-loader-overlay">
          <div className="page-loader-spinner" />
          <span className="page-loader-text">Generating duty assignment…</span>
        </div>
      )}
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

        <div className="form-group half-width">
          <label>Start From Where Left</label>
          <select
            value={startFromWhereLeft ? "true" : "false"}
            onChange={(e) =>
              setStartFromWhereLeft(e.target.value === "true")
            }
            className="custom-select"
          >
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <small className="muted">
            Continue room assignment from last assigned room
          </small>
        </div>

        <div className="form-group half-width">
          <label>Allow Duplicate Entries</label>
          <select
            value={allowDuplicateEntries ? "true" : "false"}
            onChange={(e) =>
              setAllowDuplicateEntries(e.target.value === "true")
            }
            className="custom-select"
          >
            <option value="false">False</option>
            <option value="true">True</option>
          </select>
          <small className="muted">
            Allow same faculty to be assigned multiple times in a month
          </small>
        </div>
      </div>

      <div className="collapsible-section">
        <button
          type="button"
          className="collapsible-header"
          onClick={() => setExcludeConfigExpanded((prev) => !prev)}
          aria-expanded={excludeConfigExpanded}
        >
          <span className="collapsible-title">
            Exclude options
            {(excludedGroups.length + excludedSchools.length + excludedHostels.length) > 0 && (
              <span className="collapsible-badge">
                {excludedGroups.length + excludedSchools.length + excludedHostels.length} selected
              </span>
            )}
          </span>
          <span className="collapsible-icon">
            {excludeConfigExpanded ? "▼" : "▶"}
          </span>
        </button>
        {excludeConfigExpanded && (
          <div className="collapsible-content">
            {loadingOptions ? (
              <p className="muted">Loading options…</p>
            ) : (
              <>
                <div className="form-group">
                  <label>Exclude Groups</label>
                  <div className="hostel-checkboxes">
                    {groups.length === 0 ? (
                      <p className="muted">No groups for this type.</p>
                    ) : (
                      groups.map((g) => (
                        <label key={g._id} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={excludedGroups.includes(g.name)}
                            onChange={() =>
                              toggleExcluded(setExcludedGroups, g.name)
                            }
                          />
                          <span>{g.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label>Exclude Schools</label>
                  <div className="hostel-checkboxes">
                    {schools.length === 0 ? (
                      <p className="muted">No schools for this type.</p>
                    ) : (
                      schools.map((s) => (
                        <label key={s} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={excludedSchools.includes(s)}
                            onChange={() =>
                              toggleExcluded(setExcludedSchools, s)
                            }
                          />
                          <span>{s}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label>Exclude Hostels</label>
                  <div className="hostel-checkboxes">
                    {hostels.length === 0 ? (
                      <p className="muted">No hostels for this type.</p>
                    ) : (
                      hostels.map((h) => (
                        <label key={h._id} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={excludedHostels.includes(h.name)}
                            onChange={() =>
                              toggleExcluded(setExcludedHostels, h.name)
                            }
                          />
                          <span>{h.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="button-group">
        <button onClick={handleGenerateDuty} className="generate-btn">
          Generate Duty
        </button>
      </div>
    </div>
  );
}
