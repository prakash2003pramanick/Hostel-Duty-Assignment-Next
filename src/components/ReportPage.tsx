"use client";

import { useState } from "react";

interface FacultyInfo {
  _id?: string;
  name?: string;
  title?: string;
  employeeCode?: string;
  designation?: string;
  orgUnit?: string;
  officialEmail?: string;
  personalEmail?: string;
  mobile?: string;
}

interface HistoryDoc {
  _id: string;
  date: string;
  hostel?: string;
  group?: string;
  roomRange?: string;
  startRoom?: number;
  endRoom?: number;
  faculty?: FacultyInfo[];
}

export default function ReportPage() {
  const [empCode, setEmpCode] = useState("");
  const [history, setHistory] = useState<HistoryDoc[] | null>(null);
  const [matchedFaculty, setMatchedFaculty] = useState<FacultyInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = async () => {
    const code = empCode.trim();
    if (!code) {
      setError("Please enter an employee code.");
      setHistory(null);
      setMatchedFaculty(null);
      return;
    }

    setLoading(true);
    setError("");
    setHistory(null);
    setMatchedFaculty(null);

    try {
      const res = await fetch(
        `/api/duty/report/${encodeURIComponent(code)}`,
        { method: "GET" }
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to fetch");
      }

      const hist = Array.isArray(data.history) ? data.history : data.history || [];
      const facultyInfo = data.faculty || null;

      if (hist.length === 0 && !facultyInfo) {
        setError("No records found for this employee code.");
        setHistory([]);
        setMatchedFaculty(null);
      } else {
        setHistory(hist);
        setMatchedFaculty(facultyInfo || (hist[0]?.faculty?.[0] ?? null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleDateString();
  };

  return (
    <div className="report-container">
      <h1>Faculty Duty Report</h1>

      <div className="search-row">
        <input
          type="text"
          placeholder="Enter Employee Code (e.g. 106008)"
          value={empCode}
          onChange={(e) => setEmpCode(e.target.value)}
          className="input custom-select"
        />
        <button
          onClick={handleSearch}
          className="btn"
          disabled={loading}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {matchedFaculty && (
        <div className="faculty-card">
          <div>
            <div className="faculty-name">
              {matchedFaculty.title} {matchedFaculty.name}{" "}
              <span className="empcode">({matchedFaculty.employeeCode})</span>
            </div>
            <div className="faculty-meta">
              <div>{matchedFaculty.designation}</div>
              <div>{matchedFaculty.orgUnit}</div>
            </div>
          </div>
          <div>
            <div>
              <strong>Email:</strong>{" "}
              {matchedFaculty.officialEmail ||
                matchedFaculty.personalEmail ||
                "-"}
            </div>
            <div>
              <strong>Mobile:</strong> {matchedFaculty.mobile || "-"}
            </div>
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <>
          <h2>Duty History ({history.length})</h2>

          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Hostel</th>
                  <th>Group</th>
                  <th>Room Range</th>
                  <th>Matched Faculty</th>
                  <th>Other Faculty</th>
                </tr>
              </thead>
              <tbody>
                {history.map((doc) => {
                  const matched = doc.faculty?.[0];
                  const others = (doc.faculty || []).slice(1);
                  return (
                    <tr key={doc._id}>
                      <td>{formatDate(doc.date)}</td>
                      <td>{doc.hostel || "-"}</td>
                      <td>{doc.group || "-"}</td>
                      <td>
                        {doc.roomRange ||
                          `${doc.startRoom || "-"}-${doc.endRoom || "-"}`}
                      </td>
                      <td>
                        {matched ? (
                          <div className="matched">
                            {matched.title} {matched.name}
                            <div className="small">{matched.employeeCode}</div>
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        {others.length > 0 ? (
                          others.map((f) => (
                            <div
                              key={f._id || f.employeeCode || ""}
                              className="other-faculty"
                            >
                              {f.title} {f.name}{" "}
                              <span className="small">({f.employeeCode})</span>
                            </div>
                          ))
                        ) : (
                          <span className="small">No other faculty</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
