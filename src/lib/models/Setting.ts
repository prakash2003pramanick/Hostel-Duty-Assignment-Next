import mongoose from "mongoose";

const SettingSchema = new mongoose.Schema({
  boysHostel: { type: Number, required: true },
  girlsHostel: { type: Number, required: true },
});

export default mongoose.models.Setting || mongoose.model("Setting", SettingSchema);
