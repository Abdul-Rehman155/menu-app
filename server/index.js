import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveMongoUri } from "./config/mongo-uri.js";
import { hasCloudinaryConfig, uploadImageBuffer } from "./config/cloudinary.js";
import { uploadImage, validateImageBuffer } from "./middleware/image-upload.js";
import { sendUploadError } from "./middleware/upload-error.js";
import { defaultPlans, getPlanDefinition } from "./config/plans.js";
import Restaurant from "./models/Restaurant.js";
import User from "./models/User.js";
import Order from "./models/Order.js";
import SubscriptionPlan from "./models/SubscriptionPlan.js";
import PlatformSetting from "./models/PlatformSetting.js";
import AuditLog from "./models/AuditLog.js";

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
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({ frameguard: { action: "deny" }, crossOriginResourcePolicy: { policy: "same-site" }, referrerPolicy: { policy: "no-referrer" } }));
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
app.use(express.json({ limit: "2mb" }));
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
const makeLimiter = (limit) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  handler: (_req, res) => res.status(429).json({ error: "Too many requests. Try again later." }),
});
app.use("/api", makeLimiter(400));
app.use("/api/auth", makeLimiter(25));
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeRestaurant = (r) => { const o = r.toObject(); delete o.passwordHash; return o; };
const publicRestaurant = (r) => {
  const source = r.toObject();
  const fields = ["slug", "businessType", "name", "tagline", "description", "area", "address", "rating", "eta", "hours", "openingTime", "closingTime", "whatsapp", "phone", "email", "logo", "coverImage", "currency", "deliveryFee", "minOrderAmount", "taxPercent", "deliveryEnabled", "pickupEnabled", "dineInEnabled", "isOpen", "menu"];
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
};
const auth = asyncRoute(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret, { issuer: "restaurant-saas", algorithms: ["HS256"] });
  } catch { return res.status(401).json({ error: "Invalid or expired session" }); }
  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.role !== payload.role) return res.status(401).json({ error: "Session is no longer valid" });
  req.user = user; next();
});
const owner = (req, res, next) => req.user?.role === "owner" ? next() : res.status(403).json({ error: "Owner access required" });
const admin = (req, res, next) => req.user?.role === "super_admin" ? next() : res.status(403).json({ error: "Super admin access required" });
const ownedRestaurant = asyncRoute(async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.user.restaurantId)) return res.status(404).json({ error: "Restaurant not found or suspended" });
  const restaurant = await Restaurant.findOne({ _id: req.user.restaurantId, status: "active" });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found or suspended" });
  req.restaurant = restaurant; next();
});
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageParams = (req) => ({ page: Math.max(1, Number.parseInt(req.query.page, 10) || 1), limit: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20)) });
const orderStatuses = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"];
const getBusinessPlan = async (business) => {
  const aliases = { starter: "basic", pro: "professional" };
  const key = aliases[business.plan] || business.plan || "free";
  const configured = await SubscriptionPlan.findOne({ key }).lean();
  return getPlanDefinition(key, configured);
};
const writeAuditLog = async (req, { action, targetType, targetId = "", restaurantId, details = {} }) => {
  try { await AuditLog.create({ actorId: req.user._id, action, targetType, targetId: String(targetId), restaurantId, details }); }
  catch (error) { console.error("Audit log write failed:", error.name || "Error", error.code || ""); }
};

app.get("/", (_req, res) => res.json({ ok: true, service: "restaurant-saas-api" }));
app.get("/api/health", (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ ok: connected, service: "restaurant-saas-api", database: connected ? "connected" : "disconnected" });
});
let maintenanceCache = { enabled: false, expiresAt: 0 };
app.use("/api", asyncRoute(async (req, res, next) => {
  if (req.path.startsWith("/admin") || req.path === "/auth/login" || req.path === "/health") return next();
  if (Date.now() >= maintenanceCache.expiresAt) {
    const setting = await PlatformSetting.findOne({ key: "maintenanceMode" }).lean();
    maintenanceCache = { enabled: setting?.value === true, expiresAt: Date.now() + 15_000 };
  }
  if (maintenanceCache.enabled) return res.status(503).json({ error: "The platform is temporarily unavailable for maintenance" });
  next();
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const registrationSetting = await PlatformSetting.findOne({ key: "ownerRegistrationEnabled" }).lean();
  if (registrationSetting?.value === false) return res.status(403).json({ error: "New business registration is currently closed" });
  const { name, email, password, restaurantName, slug } = req.body || {};
  const businessType = req.body?.businessType || "restaurant";
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const cleanPassword = typeof password === "string" ? password : "";
  const cleanRestaurantName = typeof restaurantName === "string" ? restaurantName.trim() : "";
  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!cleanName || cleanName.length > 100 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || cleanEmail.length > 254 || cleanPassword.length < 10 || cleanPassword.length > 128 || !cleanRestaurantName || cleanRestaurantName.length > 120 || !["restaurant", "shop"].includes(businessType) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(safeSlug)) return res.status(400).json({ error: "Provide valid owner and business details, a password (10–128 characters), business type, and a URL-friendly unique slug" });
  if (await User.exists({ email: cleanEmail })) return res.status(409).json({ error: "An account already exists for that email" });
  if (await Restaurant.exists({ slug: safeSlug })) return res.status(409).json({ error: "That restaurant URL is already taken" });
  const session = await mongoose.startSession();
  let result;
  try { await session.withTransaction(async () => {
    const restaurant = await Restaurant.create([{ slug: safeSlug, name: cleanRestaurantName, businessType, ownerId: new mongoose.Types.ObjectId() }], { session });
    const user = await User.create([{ name: cleanName, email: cleanEmail, passwordHash: await bcrypt.hash(cleanPassword, 12), restaurantId: restaurant[0]._id }], { session });
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
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : ""; const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
  if (!name || name.length > 100 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a name (up to 100 characters) and a valid email" });
  if (await User.exists({ email, _id: { $ne: req.user._id } })) return res.status(409).json({ error: "That email is already in use" });
  req.user.name = name; req.user.email = email; await req.user.save(); res.json({ user: { name, email, role: req.user.role } });
}));
app.post("/api/auth/change-password", auth, asyncRoute(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
  const user = await User.findById(req.user.id).select("+passwordHash");
  if (newPassword.length < 10 || newPassword.length > 128) return res.status(400).json({ error: "New password must be between 10 and 128 characters" });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ error: "Current password is incorrect" });
  user.passwordHash = await bcrypt.hash(newPassword, 12); await user.save(); res.json({ ok: true });
}));

app.get("/api/r/:slug", asyncRoute(async (req, res) => {
  const restaurant = await Restaurant.findOne({ slug: String(req.params.slug).toLowerCase(), status: "active" });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  const data = publicRestaurant(restaurant); data.menu = data.menu.filter((c) => c.enabled !== false).map((c) => ({ ...c, items: c.items.filter((i) => i.available !== false) })); res.json(data);
}));
app.post("/api/r/:slug/orders", asyncRoute(async (req, res) => {
  const restaurant = await Restaurant.findOne({ slug: String(req.params.slug).toLowerCase(), status: "active" });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  if (!restaurant.isOpen) return res.status(409).json({ error: "This restaurant is currently closed" });
  const { fulfillment, items = [] } = req.body || {};
  const customer = req.body?.customer && typeof req.body.customer === "object" && !Array.isArray(req.body.customer) ? req.body.customer : {};
  const customerName = typeof customer.name === "string" ? customer.name.trim() : "";
  const customerPhone = typeof customer.phone === "string" ? customer.phone.trim() : "";
  const address = typeof customer.address === "string" ? customer.address.trim() : "";
  const tableNumber = typeof customer.tableNumber === "string" ? customer.tableNumber.trim() : "";
  const notes = typeof customer.notes === "string" ? customer.notes.trim().slice(0, 1000) : "";
  if (!customerName || customerName.length > 100 || !/^\+?[0-9 ()-]{7,20}$/.test(customerPhone)) return res.status(400).json({ error: "Enter a customer name and valid phone number" });
  if (!["delivery", "pickup", "dine-in"].includes(fulfillment) || !Array.isArray(items) || items.length < 1 || items.length > 50) return res.status(400).json({ error: "Choose a fulfillment option and add 1–50 items" });
  if (fulfillment === "delivery" && (!restaurant.deliveryEnabled || !address)) return res.status(400).json({ error: "Delivery is unavailable or an address is missing" });
  if (fulfillment === "pickup" && !restaurant.pickupEnabled) return res.status(400).json({ error: "Pickup is unavailable" });
  if (fulfillment === "dine-in" && (!restaurant.dineInEnabled || !tableNumber)) return res.status(400).json({ error: "Dine-in is unavailable or a table number is missing" });
  const orderLines = []; let subtotal = 0;
  for (const requested of items) {
    if (!requested || typeof requested !== "object") return res.status(400).json({ error: "Each order item must include a product and quantity" });
    const quantity = Number(requested.quantity); if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return res.status(400).json({ error: "Item quantities must be between 1 and 99" });
    const product = restaurant.menu.filter((category) => category.enabled !== false).flatMap((c) => c.items).find((i) => i._id.toString() === String(requested.productId));
    if (!product || !product.available) return res.status(409).json({ error: "An item in your cart is unavailable" });
    const lineTotal = Number((product.price * quantity).toFixed(2)); subtotal += lineTotal;
    orderLines.push({ productId: product._id, name: product.name, quantity, unitPrice: product.price, lineTotal });
  }
  const deliveryFee = fulfillment === "delivery" ? Number(restaurant.deliveryFee || 0) : 0;
  if (subtotal < Number(restaurant.minOrderAmount || 0)) return res.status(400).json({ error: `Minimum order is ${restaurant.currency} ${restaurant.minOrderAmount}` });
  const plan = await getBusinessPlan(restaurant);
  if (plan.limits.maxMonthlyOrders != null) {
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const monthlyOrders = await Order.countDocuments({ restaurantId: restaurant._id, createdAt: { $gte: monthStart } });
    if (monthlyOrders >= plan.limits.maxMonthlyOrders) return res.status(409).json({ error: "This business has reached its monthly order limit" });
  }
  const taxPercent = Number(restaurant.taxPercent || 0);
  const taxAmount = Number((subtotal * taxPercent / 100).toFixed(2));
  const orderNumber = `CC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const order = await Order.create({ orderNumber, restaurantId: restaurant._id, customer: { name: customerName, phone: customerPhone, address, tableNumber, notes }, fulfillment, items: orderLines, subtotal: Number(subtotal.toFixed(2)), taxPercent, taxAmount, deliveryFee, total: Number((subtotal + taxAmount + deliveryFee).toFixed(2)), currency: restaurant.currency, statusHistory: [{ status: "pending", note: "Order placed by customer" }] });
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
  const productCount = req.body.menu.reduce((count, category) => count + (Array.isArray(category?.items) ? category.items.length : 0), 0);
  if (productCount > 2000) return res.status(400).json({ error: "Menu must contain at most 2,000 products" });
  const plan = await getBusinessPlan(req.restaurant);
  if (plan.limits.maxCategories != null && req.body.menu.length > plan.limits.maxCategories) return res.status(403).json({ error: `Your ${plan.name} plan allows up to ${plan.limits.maxCategories} categories` });
  if (plan.limits.maxProducts != null && productCount > plan.limits.maxProducts) return res.status(403).json({ error: `Your ${plan.name} plan allows up to ${plan.limits.maxProducts} products` });
  req.restaurant.menu = req.body.menu; await req.restaurant.save(); res.json({ menu: req.restaurant.menu });
}));
app.post("/api/owner/uploads", auth, owner, ownedRestaurant, uploadImage.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Select a JPEG, PNG, or WebP image to upload" });
  const plan = await getBusinessPlan(req.restaurant);
  if (!plan.features.imageUploads) return res.status(403).json({ error: `Image uploads are not included in the ${plan.name} plan` });
  if (!hasCloudinaryConfig()) return res.status(503).json({ error: "Image uploads are not configured on this server. Add the Cloudinary credentials in the backend environment." });
  if (!validateImageBuffer(req.file.buffer, req.file.mimetype)) return res.status(400).json({ error: "Image contents do not match the selected JPEG, PNG, or WebP file type" });
  let uploaded;
  try { uploaded = await uploadImageBuffer(req.file.buffer, `restaurant-saas/${req.restaurant.id}`); }
  catch (error) {
    console.error("Cloudinary image upload failed:", error.http_code || error.name || "provider error");
    return res.status(502).json({ error: "Cloudinary could not upload this image. Check the server credentials and try again." });
  }
  let imageUrl;
  try { imageUrl = new URL(uploaded?.secure_url); } catch {}
  if (!imageUrl || imageUrl.protocol !== "https:" || !uploaded?.public_id) {
    console.error("Cloudinary returned an invalid upload response");
    return res.status(502).json({ error: "Cloudinary returned an invalid image URL" });
  }
  res.status(201).json({ success: true, secure_url: imageUrl.href, public_id: uploaded.public_id, message: "Image uploaded successfully" });
}));
app.get("/api/owner/orders", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const filter = { restaurantId: req.user.restaurantId };
  if (orderStatuses.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.search) { const q = escapeRegex(String(req.query.search).slice(0, 50)); filter.$or = [{ orderNumber: { $regex: q, $options: "i" } }, { "customer.name": { $regex: q, $options: "i" } }, { "customer.phone": { $regex: q.slice(0, 30), $options: "i" } }]; }
  if (req.query.from || req.query.to) { const range = {}; if (req.query.from) { if (Number.isNaN(Date.parse(req.query.from))) return res.status(400).json({ error: "Invalid start date" }); range.$gte = new Date(req.query.from); } if (req.query.to) { if (Number.isNaN(Date.parse(req.query.to))) return res.status(400).json({ error: "Invalid end date" }); const end = new Date(req.query.to); end.setUTCHours(23, 59, 59, 999); range.$lte = end; } if (range.$gte && range.$lte && range.$gte > range.$lte) return res.status(400).json({ error: "Start date must be before end date" }); filter.createdAt = range; }
  const [orders, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(filter)]); res.json({ orders, page, limit, total });
}));
app.get("/api/owner/orders/:id", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order ID" });
  const order = await Order.findOne({ _id: req.params.id, restaurantId: req.user.restaurantId }).lean();
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order });
}));
app.patch("/api/owner/orders/:id/status", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid order ID" });
  const { status } = req.body || {}; if (!orderStatuses.includes(status)) return res.status(400).json({ error: "Invalid order status" });
  if (status === "cancelled" && !String(req.body.reason || "").trim()) return res.status(400).json({ error: "A cancellation reason is required" });
  const order = await Order.findOne({ _id: req.params.id, restaurantId: req.user.restaurantId }); if (!order) return res.status(404).json({ error: "Order not found" });
  const allowed = { pending: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["out_for_delivery", "completed", "cancelled"], out_for_delivery: ["completed", "cancelled"], completed: [], cancelled: [] };
  if (!allowed[order.status].includes(status)) return res.status(409).json({ error: `Cannot change ${order.status} to ${status}` });
  order.status = status; order.statusHistory.push({ status, by: req.user._id, note: String(req.body.reason || req.body.note || "").trim().slice(0, 300) }); await order.save(); res.json({ order });
}));
app.get("/api/owner/analytics", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const plan = await getBusinessPlan(req.restaurant);
  if (!plan.features.analytics) return res.status(403).json({ error: `Analytics are not included in the ${plan.name} plan` });
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
app.get("/api/owner/customers", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const match = { restaurantId: new mongoose.Types.ObjectId(req.user.restaurantId) };
  const q = String(req.query.search || "").trim().slice(0, 50);
  const pipeline = [{ $match: match }, { $sort: { createdAt: -1 } }, { $group: { _id: "$customer.phone", name: { $first: "$customer.name" }, phone: { $first: "$customer.phone" }, totalOrders: { $sum: 1 }, amountSpent: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 0, "$total"] } }, lastOrderAt: { $max: "$createdAt" } } }];
  if (q) pipeline.push({ $match: { $or: [{ name: { $regex: escapeRegex(q), $options: "i" } }, { phone: { $regex: escapeRegex(q), $options: "i" } }] } });
  const [rows, count] = await Promise.all([Order.aggregate([...pipeline, { $sort: { lastOrderAt: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }]), Order.aggregate([...pipeline, { $count: "total" }])]);
  res.json({ customers: rows, page, limit, total: count[0]?.total || 0 });
}));
app.get("/api/owner/reports", auth, owner, ownedRestaurant, asyncRoute(async (req, res) => {
  const plan = await getBusinessPlan(req.restaurant);
  if (!plan.features.reports) return res.status(403).json({ error: `Reports are not included in the ${plan.name} plan` });
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
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const [total, active, suspended, totalOwners, orders, monthlyOrders] = await Promise.all([Restaurant.countDocuments(), Restaurant.countDocuments({ status: "active" }), Restaurant.countDocuments({ status: "suspended" }), User.countDocuments({ role: "owner" }), Order.countDocuments(), Order.countDocuments({ createdAt: { $gte: monthStart } })]);
  res.json({ totalRestaurants: total, activeRestaurants: active, suspendedRestaurants: suspended, totalOwners, totalOrders: orders, monthlyOrders });
}));
app.get("/api/admin/restaurants", auth, admin, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const q = escapeRegex(String(req.query.search || "").slice(0, 60)); const filter = {};
  if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { slug: { $regex: q, $options: "i" } }];
  if (["active", "suspended"].includes(req.query.status)) filter.status = req.query.status;
  if (["restaurant", "shop"].includes(req.query.businessType)) filter.businessType = req.query.businessType;
  const [restaurants, total] = await Promise.all([Restaurant.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Restaurant.countDocuments(filter)]); res.json({ restaurants, page, limit, total });
}));
app.patch("/api/admin/restaurants/:id/status", auth, admin, asyncRoute(async (req, res) => {
  if (!["active", "suspended"].includes(req.body?.status)) return res.status(400).json({ error: "Status must be active or suspended" });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid restaurant ID" });
  const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true }); if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  await writeAuditLog(req, { action: `business.${req.body.status}`, targetType: "restaurant", targetId: restaurant.id, restaurantId: restaurant._id });
  res.json({ restaurant: safeRestaurant(restaurant) });
}));

app.get("/api/admin/owners", auth, admin, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const q = escapeRegex(String(req.query.search || "").trim().slice(0, 60));
  const filter = { role: "owner" };
  if (req.query.status === "active") filter.active = true;
  if (req.query.status === "disabled") filter.active = false;
  if (q) filter.$or = [{ name: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
  const [owners, total] = await Promise.all([User.find(filter).select("name email active restaurantId createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
  res.json({ owners, page, limit, total });
}));
app.patch("/api/admin/owners/:id/status", auth, admin, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid owner ID" });
  if (typeof req.body?.active !== "boolean") return res.status(400).json({ error: "active must be true or false" });
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: "owner" }, { active: req.body.active }, { new: true, runValidators: true }).select("name email active restaurantId");
  if (!user) return res.status(404).json({ error: "Owner account not found" });
  await writeAuditLog(req, { action: req.body.active ? "owner.activated" : "owner.suspended", targetType: "user", targetId: user.id, restaurantId: user.restaurantId });
  res.json({ owner: { id: user.id, name: user.name, email: user.email, active: user.active, restaurantId: user.restaurantId } });
}));

app.get("/api/admin/subscription-plans", auth, admin, asyncRoute(async (_req, res) => {
  const configured = await SubscriptionPlan.find({}).lean();
  const byKey = new Map(configured.map((plan) => [plan.key, plan]));
  const plans = defaultPlans.map((plan) => getPlanDefinition(plan.key, byKey.get(plan.key)));
  for (const plan of configured) if (!plans.some((entry) => entry.key === plan.key)) plans.push(plan);
  res.json({ plans: plans.sort((a, b) => a.sortOrder - b.sortOrder) });
}));
app.put("/api/admin/subscription-plans/:key", auth, admin, asyncRoute(async (req, res) => {
  const aliases = { starter: "basic", pro: "professional" };
  const key = aliases[req.params.key] || req.params.key;
  const base = defaultPlans.find((plan) => plan.key === key);
  if (!base) return res.status(404).json({ error: "Subscription plan not found" });
  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const price = body.price === null ? null : Number(body.price);
  const currency = String(body.currency || base.currency).toUpperCase();
  const billingCycle = body.billingCycle || base.billingCycle;
  const sortOrder = Number(body.sortOrder ?? base.sortOrder);
  const validLimit = (value) => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000);
  const limits = body.limits || base.limits; const features = body.features || base.features;
  if (!name || name.length > 80 || (price !== null && (!Number.isFinite(price) || price < 0)) || !/^[A-Z]{3}$/.test(currency) || !["monthly", "yearly"].includes(billingCycle) || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || !limits || !validLimit(limits.maxCategories ?? null) || !validLimit(limits.maxProducts ?? null) || !validLimit(limits.maxMonthlyOrders ?? null) || !features || ["imageUploads", "analytics", "reports"].some((key) => typeof features[key] !== "boolean")) return res.status(400).json({ error: "Provide a valid plan name, price, currency, billing cycle, limits, and feature flags" });
  const value = { key, name, description: String(body.description || "").trim().slice(0, 500), price, currency, billingCycle, active: typeof body.active === "boolean" ? body.active : base.active, sortOrder, limits: { maxCategories: limits.maxCategories ?? null, maxProducts: limits.maxProducts ?? null, maxMonthlyOrders: limits.maxMonthlyOrders ?? null }, features: { imageUploads: features.imageUploads, analytics: features.analytics, reports: features.reports } };
  const plan = await SubscriptionPlan.findOneAndUpdate({ key }, { $set: value }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  await writeAuditLog(req, { action: "subscription_plan.updated", targetType: "subscription_plan", targetId: key, details: { name, active: value.active } });
  res.json({ plan });
}));
app.patch("/api/admin/restaurants/:id/subscription", auth, admin, asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid restaurant ID" });
  const aliases = { starter: "basic", pro: "professional" };
  const planKey = aliases[req.body?.plan] || req.body?.plan;
  if (!defaultPlans.some((plan) => plan.key === planKey)) return res.status(400).json({ error: "Choose a known subscription plan" });
  if (!(["trialing", "active", "past_due", "cancelled"].includes(req.body?.subscriptionStatus))) return res.status(400).json({ error: "Invalid subscription status" });
  const configured = await SubscriptionPlan.findOne({ key: planKey }).lean();
  if (configured?.active === false) return res.status(409).json({ error: "That subscription plan is inactive" });
  const start = req.body.subscriptionStartedAt ? new Date(req.body.subscriptionStartedAt) : new Date();
  const expiry = req.body.subscriptionExpiresAt ? new Date(req.body.subscriptionExpiresAt) : null;
  if (Number.isNaN(start.valueOf()) || (expiry && (Number.isNaN(expiry.valueOf()) || expiry <= start))) return res.status(400).json({ error: "Subscription dates are invalid" });
  const restaurant = await Restaurant.findByIdAndUpdate(req.params.id, { plan: planKey, subscriptionStatus: req.body.subscriptionStatus, subscriptionStartedAt: start, subscriptionExpiresAt: expiry }, { new: true, runValidators: true });
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found" });
  await writeAuditLog(req, { action: "subscription.assigned", targetType: "restaurant", targetId: restaurant.id, restaurantId: restaurant._id, details: { plan: planKey, status: restaurant.subscriptionStatus } });
  res.json({ restaurant: safeRestaurant(restaurant), paymentIntegration: "not_configured" });
}));

const platformSettingDefaults = [
  { key: "platformName", value: "Business Platform" },
  { key: "supportEmail", value: "" },
  { key: "defaultCurrency", value: "USD" },
  { key: "ownerRegistrationEnabled", value: true },
  { key: "maintenanceMode", value: false },
];
app.get("/api/admin/settings", auth, admin, asyncRoute(async (_req, res) => {
  const configured = await PlatformSetting.find({}).lean(); const values = new Map(configured.map((setting) => [setting.key, setting.value]));
  res.json({ settings: platformSettingDefaults.map((setting) => ({ ...setting, value: values.has(setting.key) ? values.get(setting.key) : setting.value })) });
}));
app.patch("/api/admin/settings/:key", auth, admin, asyncRoute(async (req, res) => {
  const setting = platformSettingDefaults.find((item) => item.key === req.params.key);
  if (!setting) return res.status(404).json({ error: "Platform setting not found" });
  let value = req.body?.value;
  if (["ownerRegistrationEnabled", "maintenanceMode"].includes(setting.key) && typeof value !== "boolean") return res.status(400).json({ error: "Setting value must be a boolean" });
  if (setting.key === "platformName" && (typeof value !== "string" || !value.trim() || value.trim().length > 100)) return res.status(400).json({ error: "Platform name must contain 1 to 100 characters" });
  if (setting.key === "supportEmail" && (typeof value !== "string" || value.length > 254 || (value && !/^\S+@\S+\.\S+$/.test(value)))) return res.status(400).json({ error: "Enter a valid support email or leave it blank" });
  if (setting.key === "defaultCurrency" && (typeof value !== "string" || !/^[A-Z]{3}$/i.test(value))) return res.status(400).json({ error: "Default currency must be a 3-letter code" });
  if (setting.key === "platformName" || setting.key === "supportEmail") value = value.trim();
  if (setting.key === "defaultCurrency") value = value.toUpperCase();
  const saved = await PlatformSetting.findOneAndUpdate({ key: setting.key }, { value, updatedBy: req.user._id }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true });
  if (setting.key === "maintenanceMode") maintenanceCache = { enabled: value, expiresAt: Date.now() + 15_000 };
  await writeAuditLog(req, { action: "platform_setting.updated", targetType: "platform_setting", targetId: setting.key });
  res.json({ setting: { key: saved.key, value: saved.value } });
}));
app.get("/api/admin/audit-logs", auth, admin, asyncRoute(async (req, res) => {
  const { page, limit } = pageParams(req); const filter = {};
  if (req.query.action) filter.action = String(req.query.action).slice(0, 100);
  const [logs, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditLog.countDocuments(filter)]);
  res.json({ logs, page, limit, total });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "API endpoint not found" }));
app.use(sendUploadError);
app.use((err, _req, res, _next) => { if (err?.message === "Origin is not allowed") return res.status(403).json({ error: "Origin is not allowed" }); if (err?.status === 413) return res.status(413).json({ error: "Request body is too large" }); if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON request body" }); if (err?.name === "ValidationError" || err?.name === "CastError") return res.status(400).json({ error: "Invalid data" }); if (err?.code === 11000) return res.status(409).json({ error: "That value is already in use" }); console.error("API error:", err.name || "Error", err.code || ""); res.status(500).json({ error: "Something went wrong" }); });

async function start() {
  await mongoose.connect(await resolveMongoUri(process.env.MONGO_URI));
  const port = Number(process.env.PORT || 5000);
  app.listen(port, () => console.log(`Restaurant API listening on ${port}`));
}
if (process.env.NODE_ENV !== "test") start().catch((error) => { console.error("Server startup failed:", error.name || "Error"); process.exitCode = 1; });
export default app;
