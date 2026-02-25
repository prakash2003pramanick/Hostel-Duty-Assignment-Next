import mongoose from "mongoose";

const DutySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    group: { type: String, required: true },
    hostel: { type: String, required: true },
    startRoom: { type: Number, required: true },
    endRoom: { type: Number, required: true },
    roomRange: { type: String, required: true },
    faculty1: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty" },
      name: String,
      employeeGroup: String,
    },
    faculty2: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Faculty" },
      name: String,
      employeeGroup: String,
    },
  },
  { timestamps: true }
);

export default mongoose.models.DutyAssignment ||
  mongoose.model("DutyAssignment", DutySchema);
