"use client";

import { useState } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [action, setAction] = useState("");

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = e.target.files?.[0];
    if (uploaded) setFile(uploaded);
  };

  const handleUploadExcel = async () => {
    if (!action) {
      alert("Please select an action.");
      return;
    }

    if (action === "leave") {
      alert("Leave upload is not available yet.");
      return;
    }

    if (!file) {
      alert("Please upload an Excel file.");
      return;
    }

    const formData = new FormData();
    formData.append("excelFile", file);

    try {
      const endpoint =
        action === "delete"
          ? "/api/upload/delete_employee"
          : "/api/upload/add_employee";
      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.message || "Upload failed.");
        return;
      }

      const contentType = res.headers.get("Content-Type") || "";
      if (
        contentType.includes("spreadsheet") ||
        contentType.includes("excel") ||
        contentType.includes("octet-stream")
      ) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const contentDisposition = res.headers.get("Content-Disposition");
        let filename = "processed_faculty.xlsx";
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
        alert(
          action === "delete"
            ? "Employee deletion completed. Download the status file."
            : "Faculty data uploaded successfully! Download your processed file."
        );
      } else {
        alert(
          action === "delete"
            ? "Employee deletion completed."
            : "Faculty data uploaded successfully!"
        );
      }
    } catch (err) {
      console.error(err);
      alert(
        action === "delete"
          ? "Error deleting employees."
          : "Error uploading file."
      );
    }
  };

  const getSampleFileLink = () => {
    switch (action) {
      case "add":
        return "/add_faculty_sample.xlsx";
      case "delete":
        return "/delete_faculty_sample.xlsx";
      case "leave":
        return "/leave_sample.xlsx";
      default:
        return "";
    }
  };

  return (
    <div className="container">
      <h1>Upload Faculty Data</h1>

      <div className="form-group">
        <label>Action</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="custom-select"
        >
          <option value="">Select Action</option>
          <option value="add">Add Faculty</option>
          <option value="delete">Delete Faculty</option>
          <option value="leave">Leave</option>
        </select>
      </div>

      {action && (
        <div className="form-group">
          <label>Sample File</label>
          <a href={getSampleFileLink()} download className="sample-link">
            Download Sample Excel for{" "}
            {action === "add"
              ? "Add Faculty"
              : action === "delete"
              ? "Delete Faculty"
              : "Leave"}
          </a>
        </div>
      )}

      <div className="form-group">
        <label>Upload Excel File</label>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
        />
      </div>

      <div className="button-group">
        <button onClick={handleUploadExcel} className="upload-btn">
          {action === "delete" ? "Delete Employees" : "Upload Faculty Data"}
        </button>
      </div>
    </div>
  );
}
