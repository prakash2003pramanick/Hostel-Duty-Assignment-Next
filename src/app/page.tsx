"use client";

import { useState } from "react";
import HomePage from "@/components/HomePage";
import UploadPage from "@/components/UploadPage";
import ReportPage from "@/components/ReportPage";
import SettingPage from "@/components/SettingPage";

export default function App() {
  const [activeTab, setActiveTab] = useState("home");

  return (
    <>
      <div className="header">
        <h1 className="heading">Hostel Duty Assignment System</h1>
      </div>

      <div className="app-container">
        <div className="main-box">
          <div className="tab-bar">
            <button
              className={`tab-button ${activeTab === "home" ? "active" : ""}`}
              onClick={() => setActiveTab("home")}
            >
              Home
            </button>
            <button
              className={`tab-button ${activeTab === "upload" ? "active" : ""}`}
              onClick={() => setActiveTab("upload")}
            >
              Upload Faculty Data
            </button>
            <button
              className={`tab-button ${activeTab === "report" ? "active" : ""}`}
              onClick={() => setActiveTab("report")}
            >
              Report
            </button>
            <button
              className={`tab-button ${activeTab === "setting" ? "active" : ""}`}
              onClick={() => setActiveTab("setting")}
            >
              Setting
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "home" && <HomePage />}
            {activeTab === "upload" && <UploadPage />}
            {activeTab === "report" && <ReportPage />}
            {activeTab === "setting" && <SettingPage />}
          </div>
        </div>
      </div>
    </>
  );
}
