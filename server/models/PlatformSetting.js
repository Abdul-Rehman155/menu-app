import mongoose from "mongoose";

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export default mongoose.model("PlatformSetting", schema);
