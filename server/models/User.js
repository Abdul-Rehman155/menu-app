import mongoose from "mongoose";
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false }, role: { type: String, enum: ["owner", "super_admin"], default: "owner", index: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true }, active: { type: Boolean, default: true },
}, { timestamps: true });
export default mongoose.model("User", schema);
