import mongoose from "mongoose";

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  price: { type: Number, required: true, min: 0 },
  desc: { type: String, default: "", maxlength: 500 },
  emoji: { type: String, default: "🍽️" },
  image: { type: String, default: "" },
  popular: { type: Boolean, default: false },
  available: { type: Boolean, default: true },
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  category: { type: String, required: true, trim: true, maxlength: 80 },
  emoji: { type: String, default: "🍴" },
  enabled: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  items: [itemSchema],
});

const schema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  status: { type: String, enum: ["active", "suspended"], default: "active", index: true },
  plan: { type: String, enum: ["free", "starter", "pro"], default: "free" },
  subscriptionStatus: { type: String, enum: ["trialing", "active", "past_due", "cancelled"], default: "trialing" },
  name: { type: String, default: "", trim: true }, tagline: { type: String, default: "" }, description: { type: String, default: "" },
  area: { type: String, default: "" }, address: { type: String, default: "" }, rating: { type: Number, min: 0, max: 5 },
  eta: { type: String, default: "" }, hours: { type: String, default: "" }, whatsapp: { type: String, default: "" },
  phone: { type: String, default: "" }, email: { type: String, default: "" }, logo: { type: String, default: "" }, coverImage: { type: String, default: "" },
  currency: { type: String, default: "Rs" }, deliveryFee: { type: Number, default: 0, min: 0 }, deliveryEnabled: { type: Boolean, default: true }, pickupEnabled: { type: Boolean, default: true }, dineInEnabled: { type: Boolean, default: true },
  menu: [categorySchema],
}, { timestamps: true });

schema.index({ ownerId: 1, slug: 1 });
export default mongoose.model("Restaurant", schema);
