"use client";

import { useEffect, useState } from "react";

interface Hostel {
  _id: string;
  name: string;
  type?: string;
  capacity?: number;
  numberOfRooms?: number;
  associatedSchools?: string[];
  nonAssociatedSchools?: string[];
}

interface Group {
  _id: string;
  name: string;
  type?: string;
  numberOfFacutlyPerDay?: number;
  school?: string;
  hostelName?: string[];
}

export default function SettingPage() {
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"hostels" | "groups">("hostels");

  const [hostelForm, setHostelForm] = useState({
    name: "",
    type: "BOYS",
    capacity: "",
    numberOfRooms: "",
    associatedSchools: "",
    nonAssociatedSchools: "",
  });
  const [editingHostel, setEditingHostel] = useState<Hostel | null>(null);

  const [groupForm, setGroupForm] = useState({
    name: "",
    type: "BOYS",
    numberOfFacutlyPerDay: 2,
    school: "OTHER",
    hostelName: [] as string[],
  });
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);

  const fetchHostels = async () => {
    try {
      const res = await fetch("/api/hostels");
      const data = await res.json();
      if (res.ok) setHostels(data.hostels || []);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await fetch("/api/groups");
      const data = await res.json();
      if (res.ok) setGroups(data.groups || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchHostels(), fetchGroups()]);
      setLoading(false);
    };
    load();
  }, []);

  const parseSchools = (str: string) =>
    (str || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const handleHostelChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setHostelForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleHostelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: hostelForm.name.trim(),
      type: hostelForm.type,
      capacity: parseInt(hostelForm.capacity, 10),
      numberOfRooms: parseInt(hostelForm.numberOfRooms, 10),
      associatedSchools: parseSchools(hostelForm.associatedSchools),
      nonAssociatedSchools: parseSchools(hostelForm.nonAssociatedSchools),
      replaceSchools: true,
    };
    if (isNaN(payload.capacity) || isNaN(payload.numberOfRooms)) {
      alert("Please enter valid capacity and number of rooms.");
      return;
    }
    try {
      const res = await fetch("/api/hostel/add-or-update-manually", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Hostel saved.");
        setHostelForm({
          name: "",
          type: "BOYS",
          capacity: "",
          numberOfRooms: "",
          associatedSchools: "",
          nonAssociatedSchools: "",
        });
        setEditingHostel(null);
        fetchHostels();
      } else {
        alert(data.message || "Failed to save hostel.");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving hostel.");
    }
  };

  const handleHostelEdit = (h: Hostel) => {
    setEditingHostel(h);
    setHostelForm({
      name: h.name,
      type: h.type || "BOYS",
      capacity: String(h.capacity ?? ""),
      numberOfRooms: String(h.numberOfRooms ?? ""),
      associatedSchools: (h.associatedSchools || []).join(", "),
      nonAssociatedSchools: (h.nonAssociatedSchools || []).join(", "),
    });
  };

  const handleHostelDelete = async (h: Hostel) => {
    if (!window.confirm(`Delete hostel "${h.name}"?`)) return;
    try {
      const res = await fetch("/api/hostel/add-or-update-manually", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: h.name, delete: true }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Hostel deleted.");
        setEditingHostel(null);
        setHostelForm({
          name: "",
          type: "BOYS",
          capacity: "",
          numberOfRooms: "",
          associatedSchools: "",
          nonAssociatedSchools: "",
        });
        fetchHostels();
      } else {
        alert(data.message || "Failed to delete.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting hostel.");
    }
  };

  const handleGroupChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setGroupForm((prev) => ({ ...prev, [name]: value }));
  };

  const toggleGroupHostel = (hostelName: string) => {
    setGroupForm((prev) => {
      const list = prev.hostelName || [];
      const has = list.includes(hostelName);
      return {
        ...prev,
        hostelName: has ? list.filter((h) => h !== hostelName) : [...list, hostelName],
      };
    });
  };

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: groupForm.name.trim(),
      type: groupForm.type,
      numberOfFacutlyPerDay: parseInt(String(groupForm.numberOfFacutlyPerDay), 10) || 2,
      school: groupForm.school.trim() || "OTHER",
      hostelName: groupForm.hostelName || [],
      replaceHostels: true,
    };
    if (!payload.name) {
      alert("Group name is required.");
      return;
    }
    try {
      const res = await fetch("/api/group/add-or-update-manually", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        const first = data.groups?.[0];
        if (first?.error) {
          alert(first.error);
        } else {
          alert(data.message || "Group saved.");
          setGroupForm({
            name: "",
            type: "BOYS",
            numberOfFacutlyPerDay: 2,
            school: "OTHER",
            hostelName: [],
          });
          setEditingGroup(null);
          fetchGroups();
        }
      } else {
        alert(data.message || "Failed to save group.");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving group.");
    }
  };

  const handleGroupEdit = (g: Group) => {
    setEditingGroup(g);
    setGroupForm({
      name: g.name,
      type: g.type || "BOYS",
      numberOfFacutlyPerDay: g.numberOfFacutlyPerDay ?? 2,
      school: g.school || "OTHER",
      hostelName: g.hostelName || [],
    });
  };

  const handleGroupDelete = async (g: Group) => {
    if (!window.confirm(`Delete group "${g.name}"?`)) return;
    try {
      const res = await fetch("/api/group/add-or-update-manually", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: g.name,
          hostelName: g.hostelName || [],
          delete: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || "Group deleted.");
        setEditingGroup(null);
        setGroupForm({
          name: "",
          type: "BOYS",
          numberOfFacutlyPerDay: 2,
          school: "OTHER",
          hostelName: [],
        });
        fetchGroups();
      } else {
        alert(data.message || "Failed to delete.");
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting group.");
    }
  };

  const hostelsForGroupType = hostels.filter(
    (h) => (h.type || "").toUpperCase() === (groupForm.type || "BOYS").toUpperCase()
  );

  const preventScroll = (e: React.WheelEvent) =>
    (e.currentTarget as HTMLElement).blur();

  if (loading) {
    return (
      <div className="container settings-page">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container settings-page">
      <h1>Hostel &amp; Group Settings</h1>

      <div className="settings-tabs">
        <button
          className={`settings-tab ${activeSection === "hostels" ? "active" : ""}`}
          onClick={() => setActiveSection("hostels")}
        >
          Hostels
        </button>
        <button
          className={`settings-tab ${activeSection === "groups" ? "active" : ""}`}
          onClick={() => setActiveSection("groups")}
        >
          Groups
        </button>
      </div>

      {activeSection === "hostels" && (
        <div className="settings-section">
          <h2>Manage Hostels</h2>
          <form onSubmit={handleHostelSubmit} className="settings-form">
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input
                  type="text"
                  name="name"
                  value={hostelForm.name}
                  onChange={handleHostelChange}
                  placeholder="e.g. KP-1"
                  required
                  className="custom-select"
                />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select
                  name="type"
                  value={hostelForm.type}
                  onChange={handleHostelChange}
                  className="custom-select"
                >
                  <option value="BOYS">BOYS</option>
                  <option value="GIRLS">GIRLS</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Capacity</label>
                <input
                  type="number"
                  name="capacity"
                  value={hostelForm.capacity}
                  onChange={handleHostelChange}
                  onWheel={preventScroll}
                  placeholder="e.g. 500"
                  required
                  className="custom-select"
                />
              </div>
              <div className="form-group">
                <label>Number of Rooms</label>
                <input
                  type="number"
                  name="numberOfRooms"
                  value={hostelForm.numberOfRooms}
                  onChange={handleHostelChange}
                  onWheel={preventScroll}
                  placeholder="e.g. 100"
                  required
                  className="custom-select"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Associated Schools (comma-separated)</label>
              <input
                type="text"
                name="associatedSchools"
                value={hostelForm.associatedSchools}
                onChange={handleHostelChange}
                placeholder="e.g. School1, School2"
                className="custom-select"
              />
            </div>
            <div className="form-group">
              <label>Non-Associated Schools (comma-separated)</label>
              <input
                type="text"
                name="nonAssociatedSchools"
                value={hostelForm.nonAssociatedSchools}
                onChange={handleHostelChange}
                placeholder="e.g. School3"
                className="custom-select"
              />
            </div>
            <div className="button-group">
              <button type="submit" className="generate-btn">
                {editingHostel ? "Update Hostel" : "Add Hostel"}
              </button>
              {editingHostel && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditingHostel(null);
                    setHostelForm({
                      name: "",
                      type: "BOYS",
                      capacity: "",
                      numberOfRooms: "",
                      associatedSchools: "",
                      nonAssociatedSchools: "",
                    });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div className="settings-list">
            <h3>Existing Hostels ({hostels.length})</h3>
            {hostels.length === 0 ? (
              <p className="muted">No hostels yet. Add one above.</p>
            ) : (
              <ul className="item-list">
                {hostels.map((h) => (
                  <li key={h._id} className="item-row">
                    <span className="item-info">
                      <strong>{h.name}</strong> ({h.type}) – {h.numberOfRooms} rooms
                    </span>
                    <span className="item-actions">
                      <button
                        type="button"
                        className="btn-small"
                        onClick={() => handleHostelEdit(h)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-small btn-danger"
                        onClick={() => handleHostelDelete(h)}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {activeSection === "groups" && (
        <div className="settings-section">
          <h2>Manage Groups</h2>
          <form onSubmit={handleGroupSubmit} className="settings-form">
            <div className="form-row">
              <div className="form-group">
                <label>Group Name</label>
                <input
                  type="text"
                  name="name"
                  value={groupForm.name}
                  onChange={handleGroupChange}
                  placeholder="e.g. Group 1"
                  required
                  className="custom-select"
                />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select
                  name="type"
                  value={groupForm.type}
                  onChange={handleGroupChange}
                  className="custom-select"
                >
                  <option value="BOYS">BOYS</option>
                  <option value="GIRLS">GIRLS</option>
                </select>
              </div>
              <div className="form-group">
                <label>Faculty per Day</label>
                <input
                  type="number"
                  name="numberOfFacutlyPerDay"
                  value={groupForm.numberOfFacutlyPerDay}
                  onChange={handleGroupChange}
                  onWheel={preventScroll}
                  min={1}
                  max={4}
                  className="custom-select"
                />
              </div>
              <div className="form-group">
                <label>School</label>
                <input
                  type="text"
                  name="school"
                  value={groupForm.school}
                  onChange={handleGroupChange}
                  placeholder="e.g. OTHER"
                  className="custom-select"
                />
              </div>
            </div>
            <div className="form-group">
              <label>
                Hostels in this group (select from existing {groupForm.type} hostels)
              </label>
              <div className="hostel-checkboxes">
                {hostelsForGroupType.length === 0 ? (
                  <p className="muted">
                    No {groupForm.type} hostels. Add hostels first.
                  </p>
                ) : (
                  hostelsForGroupType.map((h) => (
                    <label key={h._id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={(groupForm.hostelName || []).includes(h.name)}
                        onChange={() => toggleGroupHostel(h.name)}
                      />
                      <span>{h.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="button-group">
              <button type="submit" className="generate-btn">
                {editingGroup ? "Update Group" : "Add Group"}
              </button>
              {editingGroup && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupForm({
                      name: "",
                      type: "BOYS",
                      numberOfFacutlyPerDay: 2,
                      school: "OTHER",
                      hostelName: [],
                    });
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <div className="settings-list">
            <h3>Existing Groups ({groups.length})</h3>
            {groups.length === 0 ? (
              <p className="muted">No groups yet. Add one above.</p>
            ) : (
              <ul className="item-list">
                {groups.map((g) => (
                  <li key={g._id} className="item-row">
                    <span className="item-info">
                      <strong>{g.name}</strong> ({g.type}) – {g.numberOfFacutlyPerDay} faculty/day
                      {g.hostelName?.length ? (
                        <span className="small">
                          {" "}
                          – Hostels: {g.hostelName.join(", ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="item-actions">
                      <button
                        type="button"
                        className="btn-small"
                        onClick={() => handleGroupEdit(g)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-small btn-danger"
                        onClick={() => handleGroupDelete(g)}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
