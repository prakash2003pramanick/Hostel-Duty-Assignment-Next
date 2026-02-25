import mongoose from "mongoose";

const GroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    hostelName: [{ type: String, required: true, trim: true }],
    numberOfFacutlyPerDay: { type: Number, required: true },
    type: { type: String, enum: ["BOYS", "GIRLS"], required: true },
    school: { type: String, required: true, trim: true, default: "OTHER" },
  },
  { timestamps: true }
);

export default mongoose.models.Group || mongoose.model("Group", GroupSchema);
