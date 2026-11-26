import mongoose from "mongoose";
const statuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"];
const schema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true }, restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  customer: { name: { type: String, required: true }, phone: { type: String, required: true }, address: String, tableNumber: String, notes: String },
  fulfillment: { type: String, enum: ["delivery", "pickup", "dine-in"], required: true },
  items: [{ productId: { type: mongoose.Schema.Types.ObjectId, required: true }, name: { type: String, required: true }, quantity: { type: Number, required: true, min: 1 }, unitPrice: { type: Number, required: true, min: 0 }, lineTotal: { type: Number, required: true, min: 0 } }],
  subtotal: { type: Number, required: true }, taxPercent: { type: Number, default: 0 }, taxAmount: { type: Number, default: 0 }, deliveryFee: { type: Number, default: 0 }, total: { type: Number, required: true }, currency: { type: String, default: "Rs" },
  paymentMethod: { type: String, enum: ["cash"], default: "cash" }, paymentStatus: { type: String, enum: ["pending", "paid", "refunded"], default: "pending" },
  status: { type: String, enum: statuses, default: "pending", index: true }, statusHistory: [{ status: { type: String, enum: statuses }, at: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, note: String }],
}, { timestamps: true });
schema.index({ restaurantId: 1, createdAt: -1 }); schema.index({ restaurantId: 1, status: 1, createdAt: -1 }); schema.index({ restaurantId: 1, "customer.phone": 1, createdAt: -1 });
export default mongoose.model("Order", schema);
