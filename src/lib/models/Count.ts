import mongoose, { Document, Model, Schema } from "mongoose";

export interface ICount extends Document {
  empId: string;
  weekendCount: number;
  weekdaysCount: number;
  total: number;
  createdAt: Date;
  updatedAt: Date;
}

const CountSchema = new Schema<ICount>(
  {
    empId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    weekendCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    weekdaysCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Auto-calculate total before save
CountSchema.pre("save", function (next) {
  if (
    this.isModified("weekendCount") ||
    this.isModified("weekdaysCount") ||
    this.isNew
  ) {
    this.total = (this.weekdaysCount || 0) + (this.weekendCount || 0);
  }
  next();
});

export default (mongoose.models.Count as Model<ICount>) ||
  mongoose.model<ICount>("Count", CountSchema);
