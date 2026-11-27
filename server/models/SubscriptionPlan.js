import mongoose from "mongoose";

const schema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: "", maxlength: 500 },
  price: { type: Number, min: 0, default: null },
  currency: { type: String, default: "USD", uppercase: true, minlength: 3, maxlength: 3 },
  billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0, min: 0 },
  limits: {
    maxCategories: { type: Number, min: 0, default: null },
    maxProducts: { type: Number, min: 0, default: null },
    maxMonthlyOrders: { type: Number, min: 0, default: null },
  },
  features: {
    imageUploads: { type: Boolean, default: true },
    analytics: { type: Boolean, default: true },
    reports: { type: Boolean, default: true },
  },
}, { timestamps: true });

export default mongoose.model("SubscriptionPlan", schema);
