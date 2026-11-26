import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import Restaurant from "./models/Restaurant.js";
import User from "./models/User.js";
import { resolveMongoUri } from "./config/mongo-uri.js";

const demoMenu = [
  { category: "Chai", emoji: "☕", items: [{ name: "Doodh Patti", price: 120, desc: "Slow brewed and full bodied", emoji: "☕", popular: true }, { name: "Kashmiri Chai", price: 220, desc: "Pink tea with almonds", emoji: "🌸" }, { name: "Masala Chai", price: 150, desc: "Ginger and cardamom", emoji: "🫖" }] },
  { category: "Snacks", emoji: "🥟", items: [{ name: "Samosa (2 pcs)", price: 100, desc: "Crispy potato filling", emoji: "🥟", popular: true }, { name: "Bun Kabab", price: 180, desc: "Served with chutney", emoji: "🍔" }] },
];

async function seed() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(await resolveMongoUri(process.env.MONGO_URI));
  let restaurant = await Restaurant.findOne({ slug: "chai-corner" });
  if (!restaurant) restaurant = await Restaurant.create({ slug: "chai-corner", name: "Chai Corner", tagline: "Fresh chai and local favourites", area: "Model Town, Lahore", eta: "20–30 min", hours: "Daily · 8am–12am", whatsapp: "", currency: "Rs", menu: demoMenu });
  if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    if (process.env.OWNER_PASSWORD.length < 10) throw new Error("OWNER_PASSWORD must be at least 10 characters");
    const email = process.env.OWNER_EMAIL.toLowerCase().trim();
    let user = await User.findOne({ email });
    if (!user) user = await User.create({ name: "Restaurant Owner", email, passwordHash: await bcrypt.hash(process.env.OWNER_PASSWORD, 12), role: "owner", restaurantId: restaurant._id });
    restaurant.ownerId = user._id; await restaurant.save();
    console.log("Owner account provisioned or already present. Existing password was left unchanged.");
  } else console.log("Demo restaurant is ready. Set OWNER_EMAIL and OWNER_PASSWORD to provision its owner login.");
  if (process.env.SUPER_ADMIN_EMAIL && process.env.SUPER_ADMIN_PASSWORD) {
    if (process.env.SUPER_ADMIN_PASSWORD.length < 16) throw new Error("SUPER_ADMIN_PASSWORD must be at least 16 characters");
    const email = process.env.SUPER_ADMIN_EMAIL.toLowerCase().trim();
    const existing = await User.findOne({ email });
    if (!existing) await User.create({ name: "Platform Admin", email, passwordHash: await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD, 12), role: "super_admin" });
    else if (existing.role !== "super_admin") throw new Error("SUPER_ADMIN_EMAIL belongs to a non-admin account; refusing to promote it automatically");
    console.log("Super admin account provisioned or already present.");
  }
}
seed().catch((error) => { console.error("Seed failed:", error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
