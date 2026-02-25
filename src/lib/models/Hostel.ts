import mongoose from "mongoose";

const HostelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    capacity: { type: Number, required: true },
    numberOfRooms: { type: Number, required: true },
    associatedSchools: { type: [String], default: [] },
    nonAssociatedSchools: { type: [String], default: [] },
    type: { type: String, enum: ["BOYS", "GIRLS"], required: true },
  },
  { timestamps: true }
);

export default mongoose.models.Hostel || mongoose.model("Hostel", HostelSchema);
