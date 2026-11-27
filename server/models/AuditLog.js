import mongoose from "mongoose";

const schema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, required: true, maxlength: 100, index: true },
  targetType: { type: String, required: true, maxlength: 80 },
  targetId: { type: String, default: "", maxlength: 120 },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

schema.index({ createdAt: -1 });
export default mongoose.model("AuditLog", schema);
