import mongoose from "mongoose";

const facultySchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true },
    title: String,
    name: String,
    designation: String,
    orgUnit: String,
    employeeGroup: String,
    gender: String,
    personalEmail: String,
    officialEmail: String,
    mobile: String,
    lastDuty: {
      date: Date,
      hostel: String,
      roomAlloted: String,
      numberOfRooms: Number,
    },
    lastWeekEndDuty: { date: Date },
    leave: [
      {
        startDate: Date,
        endDate: Date,
        reason: String,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.models.Faculty || mongoose.model("Faculty", facultySchema);
