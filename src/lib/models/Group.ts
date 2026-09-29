import mongoose from "mongoose";

const GroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    hostelName: [{ type: String, required: true, trim: true }],
    numberOfFacutlyPerDay: {
      type: Number,
      required: true,
      enum: {
        values: [1, 2, 4],
        message: "numberOfFacutlyPerDay must be 1, 2, or 4",
      },
    },
    type: { type: String, enum: ["BOYS", "GIRLS"], required: true },
    school: { type: String, required: true, trim: true, default: "OTHER" },
  },
  { timestamps: true }
);

export default mongoose.models.Group || mongoose.model("Group", GroupSchema);
