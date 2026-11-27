import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveMongoUri } from "./config/mongo-uri.js";
import { parseImageDataUri } from "./config/image-upload.js";
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
const configuredOrigins = [process.env.CORS_ORIGINS, process.env.CLIENT_ORIGIN]
  .filter(Boolean)
  .flatMap((value) => value.split(","))
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
if (process.env.NODE_ENV !== "production") configuredOrigins.push("http://localhost:5173");
const allowedOrigins = new Set(configuredOrigins);
// Vercel deployment URLs for this project use `menu-<deployment>-abdul-rehman-abe3.vercel.app`.
// Anchor the pattern to both the project prefix and team suffix; never allow arbitrary Vercel tenants.
const vercelPreviewOrigin = /^https:\/\/menu-(?:app|[a-z0-9]{8,})(?:-[a-z0-9-]+)?-abdul-rehman-abe3\.vercel\.app$/i;
app.use(cors({
  origin(origin, done) {
    if (!origin || allowedOrigins.has(origin) || vercelPreviewOrigin.test(origin)) return done(null, true);
    return done(new Error("Origin is not allowed"));
  },
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: "7mb" }));
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
app.patch("/api/auth/profile", auth, asyncRoute(async (req, res) => {
  const name = String(req.body?.name || "").trim(); const email = String(req.body?.email || "").toLowerCase().trim();
  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a name (up to 100 characters) and a valid email" });
  if (await User.exists({ email, _id: { $ne: req.user._id } })) return res.status(409).json({ error: "That email is already in use" });
  req.user.name = name; req.user.email = email; await req.user.save(); res.json({ user: { name, email, role: req.user.role } });
}));
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
  if (!restaurant.isOpen) return res.status(409).json({ error: "This restaurant is currently closed" });
  const { customer = {}, fulfillment, items = [] } = req.body || {};
  if (!customer.name?.trim() || !/^\+?[0-9 ()-]{7,20}$/.test(String(customer.phone || ""))) return res.status(400).json({ error: "Enter a customer name and valid phone number" });
  if (!["delivery", "pickup", "dine-in"].includes(fulfillment) || !Array.isArray(items) || items.length < 1 || items.length > 50) return res.status(400).json({ error: "Choose a fulfillment option and add 1–50 items" });
  if (fulfillment === "delivery" && (!restaurant.deliveryEnabled || !customer.address?.trim())) return res.status(400).json({ error: "Delivery is unavailable or an address is missing" });
  if (fulfillment === "pickup" && !restaurant.pickupEnabled) return res.status(400).json({ error: "Pickup is unavailable" });
  if (fulfillment === "dine-in" && (!restaurant.dineInEnabled || !customer.tableNumber?.trim())) return res.status(400).json({ error: "Dine-in is unavailable or a table number is missing" });
  const orderLines = []; let subtotal = 0;
  for (const requested of items) {
    const quantity = Number(requested.quantity); if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return res.status(400).json({ error: "Item quantities must be between 1 and 99" });
    const product = restaurant.menu.filter((category) => category.enabled !== false).flatMap((c) => c.items).find((i) => i._id.toString() === String(requested.productId));
    if (!product || !product.available) return res.status(409).json({ error: "An item in your cart is unavailable" });
    const lineTotal = Number((product.price * quantity).toFixed(2)); subtotal += lineTotal;
    orderLines.push({ productId: product._id, name: product.name, quantity, unitPrice: product.price, lineTotal });
  }
  const deliveryFee = fulfillment === "delivery" ? Number(restaurant.deliveryFee || 0) : 0;
  if (subtotal < Number(restaurant.minOrderAmount || 0)) return res.status(400).json({ error: `Minimum order is ${restaurant.currency} ${restaurant.minOrderAmount}` });
  const taxPercent = Number(restaurant.taxPercent || 0);
  const taxAmount = Number((subtotal * taxPercent / 100).toFixed(2));
  const orderNumber = `CC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const order = await Order.create({ orderNumber, restaurantId: restaurant._id, customer: { name: customer.name.trim(), phone: String(customer.phone).trim(), address: customer.address?.trim(), tableNumber: customer.tableNumber?.trim(), notes: String(customer.notes || "").trim().slice(0, 1000) }, fulfillment, items: orderLines, subtotal: Number(subtotal.toFixed(2)), taxPercent, taxAmount, deliveryFee, total: Number((subtotal + taxAmount + deliveryFee).toFixed(2)), currency: restaurant.currency, statusHistory: [{ status: "pending", note: "Order placed by customer" }] });
  res.status(201).json({ order: { orderNumber: order.orderNumber, status: order.status, total: order.total, currency: order.currency, createdAt: order.createdAt } });
}));

app.get("/api/owner/restaurant", auth, owner, ownedRestaurant, (req, res) => res.json(safeRestaurant(req.restaurant)));
app.patch("/api/owner/restaurant", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const fields = ["name", "tagline", "description", "area", "address", "eta", "hours", "openingTime", "closingTime", "whatsapp", "phone", "email", "logo", "coverImage", "currency", "deliveryFee", "minOrderAmount", "taxPercent", "deliveryEnabled", "pickupEnabled", "dineInEnabled", "isOpen"];
  if ("deliveryFee" in req.body && (!Number.isFinite(Number(req.body.deliveryFee)) || Number(req.body.deliveryFee) < 0)) return res.status(400).json({ error: "Delivery fee must be zero or more" });
  if ("minOrderAmount" in req.body && (!Number.isFinite(Number(req.body.minOrderAmount)) || Number(req.body.minOrderAmount) < 0)) return res.status(400).json({ error: "Minimum order must be zero or more" });
  if ("taxPercent" in req.body && (!Number.isFinite(Number(req.body.taxPercent)) || Number(req.body.taxPercent) < 0 || Number(req.body.taxPercent) > 100)) return res.status(400).json({ error: "Tax must be between 0 and 100 percent" });
  if ("isOpen" in req.body && typeof req.body.isOpen !== "boolean") return res.status(400).json({ error: "isOpen must be true or false" });
  for (const key of fields) if (key in req.body) req.restaurant[key] = req.body[key];
  await req.restaurant.save(); res.json(safeRestaurant(req.restaurant));
}));
app.put("/api/owner/menu", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  if (!Array.isArray(req.body.menu) || req.body.menu.length > 100) return res.status(400).json({ error: "Menu must contain at most 100 categories" });
  req.restaurant.menu = req.body.menu; await req.restaurant.save(); res.json({ menu: req.restaurant.menu });
}));
app.post("/api/owner/uploads", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloudName || !apiKey || !apiSecret) return res.status(503).json({ error: "Image uploads are not configured on this server" });
  let image;
  try { image = parseImageDataUri(req.body?.data); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const timestamp = String(Math.floor(Date.now() / 1000)); const folder = `restaurant-saas/${req.restaurant.id}`;
  const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest("hex");
  const form = new FormData(); form.append("file", new Blob([image.buffer], { type: image.mimeType }), "upload"); form.append("api_key", apiKey); form.append("timestamp", timestamp); form.append("folder", folder); form.append("signature", signature);
  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    console.error("Cloudinary upload request failed:", error.name);
    return res.status(502).json({ error: error.name === "TimeoutError" ? "Image provider timed out. Try again." : "Could not connect to the image provider" });
  }
  if (!response.ok) {
    console.error("Cloudinary upload failed with status", response.status);
    return res.status(502).json({ error: "Image provider could not process the upload. Check the Cloudinary credentials and try again." });
  }
  const uploaded = await response.json().catch(() => null);
  let imageUrl;
  try { imageUrl = new URL(uploaded?.secure_url); } catch {}
  if (!imageUrl || imageUrl.protocol !== "https:" || !uploaded?.public_id) {
    console.error("Cloudinary returned an invalid upload response");
    return res.status(502).json({ error: "Image provider returned an invalid image URL" });
  }
  res.status(201).json({ url: imageUrl.href, publicId: uploaded.public_id, width: uploaded.width, height: uploaded.height });
}));
app.get("/api/owner/orders", auth, owner, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const filter = { restaurantId: req.user.restaurantId };
  if (orderStatuses.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.search) { const q = escapeRegex(String(req.query.search).slice(0, 50)); filter.$or = [{ orderNumber: { $regex: q, $options: "i" } }, { "customer.name": { $regex: q, $options: "i" } }, { "customer.phone": { $regex: q.slice(0, 30), $options: "i" } }]; }
  if (req.query.from || req.query.to) { const range = {}; if (req.query.from) { if (Number.isNaN(Date.parse(req.query.from))) return res.status(400).json({ error: "Invalid start date" }); range.$gte = new Date(req.query.from); } if (req.query.to) { if (Number.isNaN(Date.parse(req.query.to))) return res.status(400).json({ error: "Invalid end date" }); const end = new Date(req.query.to); end.setUTCHours(23, 59, 59, 999); range.$lte = end; } if (range.$gte && range.$lte && range.$gte > range.$lte) return res.status(400).json({ error: "Start date must be before end date" }); filter.createdAt = range; }
  const [orders, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(filter)]); res.json({ orders, page, limit, total });
}));
app.get("/api/owner/orders/:id", auth, owner, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order ID" });
  const order = await Order.findOne({ _id: req.params.id, restaurantId: req.user.restaurantId }).lean();
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order });
}));
app.patch("/api/owner/orders/:id/status", auth, owner, asyncRoute(async (req, res) => {
  const { status } = req.body || {}; if (!orderStatuses.includes(status)) return res.status(400).json({ error: "Invalid order status" });
  if (status === "cancelled" && !String(req.body.reason || "").trim()) return res.status(400).json({ error: "A cancellation reason is required" });
  const order = await Order.findOne({ _id: req.params.id, restaurantId: req.user.restaurantId }); if (!order) return res.status(404).json({ error: "Order not found" });
  const allowed = { pending: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["out_for_delivery", "completed", "cancelled"], out_for_delivery: ["completed", "cancelled"], completed: [], cancelled: [] };
  if (!allowed[order.status].includes(status)) return res.status(409).json({ error: `Cannot change ${order.status} to ${status}` });
  order.status = status; order.statusHistory.push({ status, by: req.user._id, note: String(req.body.reason || req.body.note || "").trim().slice(0, 300) }); await order.save(); res.json({ order });
}));
app.get("/api/owner/analytics", auth, owner, asyncRoute(async (req, res) => {
  const restaurantId = new mongoose.Types.ObjectId(req.user.restaurantId); const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekStart = new Date(todayStart); weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const weeklyStart = new Date(todayStart); weeklyStart.setUTCDate(weeklyStart.getUTCDate() - ((weeklyStart.getUTCDay() + 6) % 7) - 49);
  const nonCancelled = { restaurantId, status: { $ne: "cancelled" } };
  const [totalOrders, todayOrders, byStatus, allRevenue, todayRevenue, monthlyRevenue, daily, weekly, monthly, popularItems, restaurant] = await Promise.all([
    Order.countDocuments({ restaurantId }), Order.countDocuments({ restaurantId, createdAt: { $gte: todayStart } }),
    Order.aggregate([{ $match: { restaurantId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.aggregate([{ $match: nonCancelled }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([{ $match: { ...nonCancelled, createdAt: { $gte: todayStart } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([{ $match: { ...nonCancelled, createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: "$total" } } }]),
    Order.aggregate([{ $match: { restaurantId, createdAt: { $gte: weekStart } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$total"] } } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: { restaurantId, createdAt: { $gte: weeklyStart } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: { $dateTrunc: { date: "$createdAt", unit: "week", startOfWeek: "monday", timezone: "UTC" } }, timezone: "UTC" } }, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$total"] } } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: { restaurantId, createdAt: { $gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)) } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "UTC" } }, orders: { $sum: 1 }, revenue: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$total"] } } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: nonCancelled }, { $unwind: "$items" }, { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" }, revenue: { $sum: "$items.lineTotal" } } }, { $sort: { quantity: -1 } }, { $limit: 8 }]),
    Restaurant.findById(restaurantId).select("menu currency").lean(),
  ]);
  const statusMap = Object.fromEntries(byStatus.map((item) => [item._id, item.count]));
  const menuItems = restaurant?.menu.reduce((sum, category) => sum + category.items.length, 0) || 0;
  res.json({ totalOrders, todayOrders, pendingOrders: statusMap.pending || 0, acceptedOrders: statusMap.confirmed || 0, preparingOrders: statusMap.preparing || 0, completedOrders: statusMap.completed || 0, cancelledOrders: statusMap.cancelled || 0, revenue: allRevenue[0]?.total || 0, todayRevenue: todayRevenue[0]?.total || 0, monthlyRevenue: monthlyRevenue[0]?.total || 0, totalMenuItems: menuItems, statusCounts: statusMap, daily, weekly, monthly, popularItems, currency: restaurant?.currency || "Rs" });
}));
app.get("/api/owner/customers", auth, owner, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const match = { restaurantId: new mongoose.Types.ObjectId(req.user.restaurantId) };
  const q = String(req.query.search || "").trim().slice(0, 50);
  const pipeline = [{ $match: match }, { $sort: { createdAt: -1 } }, { $group: { _id: "$customer.phone", name: { $first: "$customer.name" }, phone: { $first: "$customer.phone" }, totalOrders: { $sum: 1 }, amountSpent: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$total"] } }, lastOrderAt: { $max: "$createdAt" } } }];
  if (q) pipeline.push({ $match: { $or: [{ name: { $regex: escapeRegex(q), $options: "i" } }, { phone: { $regex: escapeRegex(q), $options: "i" } }] } });
  const [rows, count] = await Promise.all([Order.aggregate([...pipeline, { $sort: { lastOrderAt: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }]), Order.aggregate([...pipeline, { $count: "total" }])]);
  res.json({ customers: rows, page, limit, total: count[0]?.total || 0 });
}));
app.get("/api/owner/reports", auth, owner, asyncRoute(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000); const to = req.query.to ? new Date(req.query.to) : new Date();
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from > to || to - from > 366 * 86400000) return res.status(400).json({ error: "Choose a valid date range up to 366 days" });
  to.setUTCHours(23, 59, 59, 999);
  const match = { restaurantId: new mongoose.Types.ObjectId(req.user.restaurantId), createdAt: { $gte: from, $lte: to }, status: { $ne: "cancelled" } };
  const [summary, sales, bestSellers] = await Promise.all([
    Order.aggregate([{ $match: match }, { $group: { _id: null, totalOrders: { $sum: 1 }, revenue: { $sum: "$total" }, subtotal: { $sum: "$subtotal" }, tax: { $sum: "$taxAmount" }, delivery: { $sum: "$deliveryFee" } } }]),
    Order.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, orders: { $sum: 1 }, revenue: { $sum: "$total" } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: match }, { $unwind: "$items" }, { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" }, revenue: { $sum: "$items.lineTotal" } } }, { $sort: { quantity: -1 } }, { $limit: 20 }]),
  ]);
  res.json({ from, to, summary: summary[0] || { totalOrders: 0, revenue: 0, subtotal: 0, tax: 0, delivery: 0 }, sales, bestSellers });
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

app.use((err, _req, res, _next) => { if (err?.message === "Origin is not allowed") return res.status(403).json({ error: "Origin is not allowed" }); if (err?.status === 413) return res.status(413).json({ error: "Request body is too large" }); if (err?.name === "ValidationError") return res.status(400).json({ error: "Invalid data", details: Object.values(err.errors).map((e) => e.message) }); if (err?.code === 11000) return res.status(409).json({ error: "That value is already in use" }); console.error("API error:", err.message); res.status(500).json({ error: "Something went wrong" }); });

async function start() {
  await mongoose.connect(await resolveMongoUri(process.env.MONGO_URI));
  const port = Number(process.env.PORT || 5000);
  app.listen(port, () => console.log(`Restaurant API listening on ${port}`));
}
if (process.env.NODE_ENV !== "test") start().catch((error) => { console.error("Server startup failed:", error.message); process.exitCode = 1; });
export default app;
