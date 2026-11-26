import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as dns from "node:dns/promises";
import Restaurant from "./models/Restaurant.js";
import User from "./models/User.js";
import Order from "./models/Order.js";

const required = ["MONGO_URI", "JWT_SECRET"];
for (const key of required) if (!process.env[key] && !(key === "JWT_SECRET" && process.env.NODE_ENV !== "production")) throw new Error(`${key} missing from server environment`);
let jwtSecret = process.env.JWT_SECRET;
if (jwtSecret && jwtSecret.length < 32 && process.env.NODE_ENV === "production") throw new Error("JWT_SECRET must contain at least 32 characters in production");
if (!jwtSecret || jwtSecret.length < 32) {
  const localSecretPath = fileURLToPath(new URL("./.jwt-secret", import.meta.url));
  if (existsSync(localSecretPath)) jwtSecret = readFileSync(localSecretPath, "utf8").trim();
  if (!jwtSecret || jwtSecret.length < 32) {
    const generated = randomBytes(48).toString("base64url");
    let descriptor;
    try {
      descriptor = openSync(localSecretPath, "wx", 0o600);
      writeFileSync(descriptor, generated, "utf8");
      jwtSecret = generated;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      jwtSecret = readFileSync(localSecretPath, "utf8").trim();
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
    if (jwtSecret.length < 32) throw new Error("Local development JWT secret file is invalid; remove server/.jwt-secret and restart");
  }
  console.warn("Using a persistent generated JWT secret for local development. Set JWT_SECRET in server/.env before production deployment.");
}
const app = express();
app.disable("x-powered-by");
app.use((_, res, next) => { res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-site" }); next(); });
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim());
app.use(cors({ origin(origin, done) { if (!origin || allowedOrigins.includes(origin)) return done(null, true); return done(new Error("Origin is not allowed")); } }));
app.use(express.json({ limit: "256kb" }));
const windows = new Map();
app.use("/api", (req, res, next) => {
  const key = `${req.ip}:${req.path.startsWith("/auth/") ? "auth" : "api"}`; const now = Date.now(); const windowMs = 15 * 60 * 1000; const max = key.endsWith(":auth") ? 25 : 400; let entry = windows.get(key);
  if (!entry || now > entry.reset) entry = { count: 0, reset: now + windowMs }; entry.count++; windows.set(key, entry); res.set("RateLimit-Remaining", String(Math.max(0, max - entry.count)));
  if (entry.count > max) return res.status(429).json({ error: "Too many requests. Try again later." }); next();
});
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeRestaurant = (r) => { const o = r.toObject(); delete o.passwordHash; return o; };
const auth = asyncRoute(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user || !user.active || user.role !== payload.role) return res.status(401).json({ error: "Session is no longer valid" });
    req.user = user; next();
  } catch { return res.status(401).json({ error: "Invalid or expired session" }); }
});
const owner = (req, res, next) => req.user?.role === "owner" ? next() : res.status(403).json({ error: "Owner access required" });
const admin = (req, res, next) => req.user?.role === "super_admin" ? next() : res.status(403).json({ error: "Super admin access required" });
const ownedRestaurant = asyncRoute(async (req, res, next) => {
  const restaurant = await Restaurant.findOne({ _id: req.user.restaurantId, status: "active" });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found or suspended" });
  req.restaurant = restaurant; next();
});
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageParams = (req) => ({ page: Math.max(1, Number.parseInt(req.query.page, 10) || 1), limit: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20)) });
const orderStatuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"];

async function resolveMongoUri(uri) {
  if (process.platform !== "win32" || !uri.startsWith("mongodb+srv://")) return uri;
  const match = /^mongodb\+srv:\/\/([^/?#]+)(.*)$/i.exec(uri);
  if (!match) return uri;
  const authority = match[1];
  const host = authority.slice(authority.lastIndexOf("@") + 1).split(":")[0].toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error("Invalid MongoDB Atlas hostname");
  const powershell = (queryName, recordType, server) => {
    const script = `$records = @(Resolve-DnsName -Name '${queryName}' -Type ${recordType} -Server ${server} -DnsOnly -ErrorAction Stop); if ('${recordType}' -eq 'SRV') { @($records | Where-Object Type -eq 'SRV' | Select-Object NameTarget,Port) | ConvertTo-Json -Compress } else { @($records | Where-Object Type -eq 'TXT' | ForEach-Object { $_.Strings -join '' }) | ConvertTo-Json -Compress }`;
    return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10000 }).trim() || "[]");
  };
  let records; let txt = [];
  if (process.platform === "win32") {
    const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
    let lastError;
    for (const server of ["8.8.8.8", "1.1.1.1"]) {
      try {
        records = asArray(powershell(`_mongodb._tcp.${host}`, "SRV", server));
        txt = asArray(powershell(host, "TXT", server)).map((value) => [value]);
        break;
      } catch (error) { lastError = error; }
    }
    if (!records?.length) throw new Error(`Could not resolve Atlas SRV records. Check DNS/network access. ${lastError?.message || "No SRV records returned"}`);
  } else {
    try {
      records = await dns.resolveSrv(`_mongodb._tcp.${host}`);
      txt = await dns.resolveTxt(host);
    } catch (error) { throw new Error(`Could not resolve Atlas SRV records. Check DNS/network access. ${error.message}`); }
  }
  if (!records?.length) throw new Error("MongoDB Atlas returned no SRV hosts");
  const credentials = authority.includes("@") ? authority.slice(0, authority.lastIndexOf("@") + 1) : "";
  const hosts = records.map((record) => `${String(record.name || record.NameTarget).replace(/\.$/, "")}:${record.port || record.Port}`).join(",");
  let suffix = match[2] || "/";
  const queryIndex = suffix.indexOf("?");
  const query = new URLSearchParams(queryIndex >= 0 ? suffix.slice(queryIndex + 1) : "");
  for (const pair of txt.flat().join("").split("&")) {
    if (!pair) continue;
    const splitAt = pair.indexOf("=");
    const key = splitAt < 0 ? pair : pair.slice(0, splitAt);
    if (!query.has(key)) query.append(key, splitAt < 0 ? "" : pair.slice(splitAt + 1));
  }
  if (!query.has("tls") && !query.has("ssl")) query.set("tls", "true");
  const path = queryIndex >= 0 ? suffix.slice(0, queryIndex) : suffix;
  suffix = `${path || "/"}?${query.toString()}`;
  console.warn("Using Windows DNS fallback to resolve MongoDB Atlas SRV records.");
  return `mongodb://${credentials}${hosts}${suffix}`;
}

app.get("/", (_req, res) => res.json({ ok: true, service: "restaurant-saas-api" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const { name, email, password, restaurantName, slug } = req.body || {};
  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(String(email || "")) || String(password || "").length < 10 || !restaurantName?.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safeSlug)) return res.status(400).json({ error: "Provide a name, valid email, password (10+ characters), restaurant name, and a URL-friendly unique slug" });
  if (await User.exists({ email: String(email).toLowerCase() })) return res.status(409).json({ error: "An account already exists for that email" });
  if (await Restaurant.exists({ slug: safeSlug })) return res.status(409).json({ error: "That restaurant URL is already taken" });
  const session = await mongoose.startSession();
  let result;
  try { await session.withTransaction(async () => {
    const restaurant = await Restaurant.create([{ slug: safeSlug, name: restaurantName.trim(), ownerId: new mongoose.Types.ObjectId() }], { session });
    const user = await User.create([{ name: name.trim(), email: String(email).toLowerCase().trim(), passwordHash: await bcrypt.hash(password, 12), restaurantId: restaurant[0]._id }], { session });
    restaurant[0].ownerId = user[0]._id; await restaurant[0].save({ session }); result = { user: user[0], restaurant: restaurant[0] };
  }); } finally { await session.endSession(); }
  const token = jwt.sign({ sub: result.user.id, role: "owner" }, jwtSecret, { expiresIn: "12h", issuer: "restaurant-saas" });
  res.status(201).json({ token, user: { name: result.user.name, email: result.user.email, role: result.user.role }, restaurant: safeRestaurant(result.restaurant) });
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body?.email || "").toLowerCase().trim(); const password = String(req.body?.password || "");
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Email or password is incorrect" });
  const token = jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: "12h", issuer: "restaurant-saas" });
  const restaurant = user.restaurantId ? await Restaurant.findById(user.restaurantId) : null;
  res.json({ token, user: { name: user.name, email: user.email, role: user.role }, restaurant: restaurant && safeRestaurant(restaurant) });
}));
app.get("/api/auth/me", auth, asyncRoute(async (req, res) => res.json({ user: { name: req.user.name, email: req.user.email, role: req.user.role }, restaurant: req.user.restaurantId ? safeRestaurant(await Restaurant.findById(req.user.restaurantId)) : null })));
app.post("/api/auth/change-password", auth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {}; const user = await User.findById(req.user.id).select("+passwordHash");
  if (String(newPassword || "").length < 10) return res.status(400).json({ error: "New password must be at least 10 characters" });
  if (!(await bcrypt.compare(String(currentPassword || ""), user.passwordHash))) return res.status(400).json({ error: "Current password is incorrect" });
  user.passwordHash = await bcrypt.hash(newPassword, 12); await user.save(); res.json({ ok: true });
}));

app.get("/api/r/:slug", asyncRoute(async (req, res) => {
  const restaurant = await Restaurant.findOne({ slug: String(req.params.slug).toLowerCase(), status: "active" });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  const data = safeRestaurant(restaurant); data.menu = data.menu.filter((c) => c.enabled !== false).map((c) => ({ ...c, items: c.items.filter((i) => i.available !== false) })); res.json(data);
}));
app.post("/api/r/:slug/orders", asyncRoute(async (req, res) => {
  const restaurant = await Restaurant.findOne({ slug: String(req.params.slug).toLowerCase(), status: "active" });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  const { customer = {}, fulfillment, items = [] } = req.body || {};
  if (!customer.name?.trim() || !/^\+?[0-9 ()-]{7,20}$/.test(String(customer.phone || ""))) return res.status(400).json({ error: "Enter a customer name and valid phone number" });
  if (!["delivery", "pickup", "dine-in"].includes(fulfillment) || !Array.isArray(items) || items.length < 1 || items.length > 50) return res.status(400).json({ error: "Choose a fulfillment option and add 1–50 items" });
  if (fulfillment === "delivery" && (!restaurant.deliveryEnabled || !customer.address?.trim())) return res.status(400).json({ error: "Delivery is unavailable or an address is missing" });
  if (fulfillment === "pickup" && !restaurant.pickupEnabled) return res.status(400).json({ error: "Pickup is unavailable" });
  if (fulfillment === "dine-in" && (!restaurant.dineInEnabled || !customer.tableNumber?.trim())) return res.status(400).json({ error: "Dine-in is unavailable or a table number is missing" });
  const orderLines = []; let subtotal = 0;
  for (const requested of items) {
    const quantity = Number(requested.quantity); if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return res.status(400).json({ error: "Item quantities must be between 1 and 99" });
    const product = restaurant.menu.flatMap((c) => c.items).find((i) => i._id.toString() === String(requested.productId));
    if (!product || !product.available) return res.status(409).json({ error: "An item in your cart is unavailable" });
    const lineTotal = Number((product.price * quantity).toFixed(2)); subtotal += lineTotal;
    orderLines.push({ productId: product._id, name: product.name, quantity, unitPrice: product.price, lineTotal });
  }
  const deliveryFee = fulfillment === "delivery" ? Number(restaurant.deliveryFee || 0) : 0;
  const orderNumber = `CC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const order = await Order.create({ orderNumber, restaurantId: restaurant._id, customer: { name: customer.name.trim(), phone: String(customer.phone).trim(), address: customer.address?.trim(), tableNumber: customer.tableNumber?.trim(), notes: String(customer.notes || "").trim().slice(0, 1000) }, fulfillment, items: orderLines, subtotal: Number(subtotal.toFixed(2)), deliveryFee, total: Number((subtotal + deliveryFee).toFixed(2)), currency: restaurant.currency, statusHistory: [{ status: "pending", note: "Order placed by customer" }] });
  res.status(201).json({ order: { orderNumber: order.orderNumber, status: order.status, total: order.total, currency: order.currency, createdAt: order.createdAt } });
}));

app.get("/api/owner/restaurant", auth, owner, ownedRestaurant, (req, res) => res.json(safeRestaurant(req.restaurant)));
app.patch("/api/owner/restaurant", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const fields = ["name", "tagline", "description", "area", "address", "eta", "hours", "whatsapp", "phone", "email", "logo", "coverImage", "currency", "deliveryFee", "deliveryEnabled", "pickupEnabled", "dineInEnabled"];
  for (const key of fields) if (key in req.body) req.restaurant[key] = req.body[key];
  await req.restaurant.save(); res.json(safeRestaurant(req.restaurant));
}));
app.put("/api/owner/menu", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body.menu) || req.body.menu.length > 100) return res.status(400).json({ error: "Menu must contain at most 100 categories" });
  req.restaurant.menu = req.body.menu; await req.restaurant.save(); res.json({ menu: req.restaurant.menu });
}));
app.get("/api/owner/orders", auth, owner, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const filter = { restaurantId: req.user.restaurantId };
  if (orderStatuses.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.search) { const q = escapeRegex(String(req.query.search).slice(0, 50)); filter.$or = [{ orderNumber: { $regex: q, $options: "i" } }, { "customer.name": { $regex: q, $options: "i" } }, { "customer.phone": { $regex: q.slice(0, 30), $options: "i" } }]; }
  const [orders, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(filter)]); res.json({ orders, page, limit, total });
}));
app.patch("/api/owner/orders/:id/status", auth, owner, asyncRoute(async (req, res) => {
  const { status } = req.body || {}; if (!orderStatuses.includes(status)) return res.status(400).json({ error: "Invalid order status" });
  const order = await Order.findOne({ _id: req.params.id, restaurantId: req.user.restaurantId }); if (!order) return res.status(404).json({ error: "Order not found" });
  const allowed = { pending: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["out_for_delivery", "completed", "cancelled"], out_for_delivery: ["completed", "cancelled"], completed: [], cancelled: [] };
  if (!allowed[order.status].includes(status)) return res.status(409).json({ error: `Cannot change ${order.status} to ${status}` });
  order.status = status; order.statusHistory.push({ status, by: req.user._id, note: String(req.body.note || "").slice(0, 300) }); await order.save(); res.json({ order });
}));
app.get("/api/owner/analytics", auth, owner, asyncRoute(async (req, res) => {
  const start = new Date(); start.setHours(0, 0, 0, 0); const restaurantId = req.user.restaurantId;
  const [all, today, statusCounts, revenue, recent, popular] = await Promise.all([
    Order.countDocuments({ restaurantId }), Order.countDocuments({ restaurantId, createdAt: { $gte: start } }),
    Order.aggregate([{ $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId), status: { $nin: ["cancelled"] } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.find({ restaurantId }).sort({ createdAt: -1 }).limit(5).lean(),
    Order.aggregate([{ $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId), status: { $ne: "cancelled" } } }, { $unwind: "$items" }, { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" }, revenue: { $sum: "$items.lineTotal" } } }, { $sort: { quantity: -1 } }, { $limit: 5 }]),
  ]);
  res.json({ totalOrders: all, todayOrders: today, pendingOrders: statusCounts.find((s) => s._id === "pending")?.count || 0, completedOrders: statusCounts.find((s) => s._id === "completed")?.count || 0, revenue: revenue[0]?.total || 0, statusCounts, recentOrders: recent, popularItems: popular });
}));
app.get("/api/admin/overview", auth, admin, asyncRoute(async (_req, res) => {
  const [total, active, suspended, orders] = await Promise.all([Restaurant.countDocuments(), Restaurant.countDocuments({ status: "active" }), Restaurant.countDocuments({ status: "suspended" }), Order.countDocuments()]); res.json({ totalRestaurants: total, activeRestaurants: active, suspendedRestaurants: suspended, totalOrders: orders });
}));
app.get("/api/admin/restaurants", auth, admin, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const q = escapeRegex(String(req.query.search || "").slice(0, 60)); const filter = q ? { $or: [{ name: { $regex: q, $options: "i" } }, { slug: { $regex: q, $options: "i" } }] } : {};
  const [restaurants, total] = await Promise.all([Restaurant.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Restaurant.countDocuments(filter)]); res.json({ restaurants, page, limit, total });
}));
app.patch("/api/admin/restaurants/:id/status", auth, admin, asyncRoute(async (req, res) => {
  if (!["active", "suspended"].includes(req.body?.status)) return res.status(400).json({ error: "Status must be active or suspended" });
  const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true }); if (!restaurant) return res.status(404).json({ error: "Restaurant not found" }); res.json({ restaurant: safeRestaurant(restaurant) });
}));

app.use((err, _req, res, _next) => { if (err?.message === "Origin is not allowed") return res.status(403).json({ error: "Origin is not allowed" }); if (err?.name === "ValidationError") return res.status(400).json({ error: "Invalid data", details: Object.values(err.errors).map((e) => e.message) }); if (err?.code === 11000) return res.status(409).json({ error: "That value is already in use" }); console.error("API error:", err.message); res.status(500).json({ error: "Something went wrong" }); });

async function start() {
  await mongoose.connect(await resolveMongoUri(process.env.MONGO_URI));
  const port = Number(process.env.PORT || 5000);
  app.listen(port, () => console.log(`Restaurant API listening on ${port}`));
}
if (process.env.NODE_ENV !== "test") start().catch((error) => { console.error("Server startup failed:", error.message); process.exitCode = 1; });
export default app;
export { resolveMongoUri };
