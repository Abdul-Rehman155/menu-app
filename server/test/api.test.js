import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { Writable } from "node:stream";
import { v2 as cloudinary } from "cloudinary";

process.env.NODE_ENV = "test";
process.env.MONGO_URI = "mongodb://127.0.0.1/restaurant-saas-test";
process.env.JWT_SECRET = "test-only-secret-with-at-least-thirty-two-chars";
process.env.CORS_ORIGINS = "https://menu-app-pearl.vercel.app";
process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
process.env.CLOUDINARY_API_KEY = "test-key";
process.env.CLOUDINARY_API_SECRET = "test-secret";

const [{ default: app }, { default: User }, { default: Restaurant }, { default: Order }, { default: SubscriptionPlan }, { default: PlatformSetting }, { default: AuditLog }] = await Promise.all([
  import("../index.js"), import("../models/User.js"), import("../models/Restaurant.js"), import("../models/Order.js"), import("../models/SubscriptionPlan.js"), import("../models/PlatformSetting.js"), import("../models/AuditLog.js"),
]);

const ownerId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();
const restaurantId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();
const ownerUser = { _id: ownerId, id: ownerId.toString(), name: "Test Owner", email: "owner@example.test", passwordHash: await bcrypt.hash("test-password-123", 4), role: "owner", active: true, restaurantId };
const adminUser = { _id: adminId, id: adminId.toString(), role: "super_admin", active: true };
const users = new Map([[ownerId.toString(), ownerUser], [adminId.toString(), adminUser]]);
let restaurantActive = true;
let capturedRestaurantFilter;
let capturedOrderFilter;
let capturedOrderDetailFilter;
let createdOrder;
let cloudinaryFailure = false;
let cloudinaryCalls = 0;
let maintenanceEnabled = false;

const restaurant = {
  _id: restaurantId,
  id: restaurantId.toString(),
  ownerId,
  slug: "test-kitchen",
  status: "active",
  plan: "pro",
  subscriptionStatus: "active",
  name: "Test Kitchen",
  currency: "Rs",
  deliveryEnabled: true,
  pickupEnabled: true,
  dineInEnabled: true,
  isOpen: true,
  deliveryFee: 50,
  minOrderAmount: 0,
  taxPercent: 10,
  menu: [{ _id: new mongoose.Types.ObjectId(), category: "Food", enabled: true, items: [{ _id: productId, name: "Rice", price: 100, available: true }] }],
  async save() {},
  toObject() {
    return { ...this, menu: this.menu.map((category) => ({ ...category, items: category.items.map((item) => ({ ...item })) })) };
  },
};

let server;
let baseUrl;
let providerStream;
const imageResult = { secure_url: "https://res.cloudinary.com/test-cloud/image/upload/test.png", public_id: "restaurant-saas/test-kitchen/test" };
const tokenFor = (user, role = user.role, options = {}) => jwt.sign({ sub: user.id, role }, process.env.JWT_SECRET, { issuer: "restaurant-saas", ...options });
const ownerToken = tokenFor(ownerUser);
const adminToken = tokenFor(adminUser);

before(async () => {
  User.findById = async (id) => users.get(String(id)) || null;
  User.findOne = (filter) => ({ select: async () => filter.email === ownerUser.email ? ownerUser : null });
  SubscriptionPlan.findOne = () => ({ lean: async () => null });
  SubscriptionPlan.find = () => ({ lean: async () => [] });
  PlatformSetting.findOne = (filter) => ({ lean: async () => filter.key === "maintenanceMode" && maintenanceEnabled ? { key: filter.key, value: true } : null });
  PlatformSetting.findOneAndUpdate = async (filter, update) => { if (filter.key === "maintenanceMode") maintenanceEnabled = update.value; return { key: filter.key, value: update.value }; };
  PlatformSetting.find = () => ({ lean: async () => [] });
  AuditLog.find = () => ({ sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] });
  AuditLog.countDocuments = async () => 0;
  AuditLog.create = async () => ({});
  Restaurant.findById = async () => restaurant;
  Restaurant.findOne = async (filter) => {
    capturedRestaurantFilter = filter;
    if (filter.status === "active" && !restaurantActive) return null;
    return restaurant;
  };
  Order.find = (filter) => {
    capturedOrderFilter = filter;
    const cursor = { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] };
    return cursor;
  };
  Order.countDocuments = async () => 0;
  Order.findOne = (filter) => {
    capturedOrderDetailFilter = filter;
    return { lean: async () => null };
  };
  Order.create = async (document) => {
    createdOrder = document;
    return { ...document, status: "pending", createdAt: new Date() };
  };
  cloudinary.uploader.upload_stream = (_options, callback) => {
    providerStream = new Writable({
      write(_chunk, _encoding, done) { done(); },
      final(done) {
        cloudinaryCalls++;
        setImmediate(() => callback(cloudinaryFailure ? new Error("mock provider failure") : null, cloudinaryFailure ? undefined : imageResult));
        done();
      },
    });
    return providerStream;
  };
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const sendImage = async ({ bytes, type = "image/png", token = ownerToken, field = "file", filename = "untrusted-name.png" } = {}) => {
  const form = new FormData();
  if (bytes) form.append(field, new Blob([bytes], { type }), filename);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return fetch(`${baseUrl}/api/owner/uploads`, { method: "POST", headers, body: form });
};

test("CORS preflight permits the configured Vercel origin and auth headers", async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, { method: "OPTIONS", headers: { Origin: "https://menu-app-pearl.vercel.app", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://menu-app-pearl.vercel.app");
  assert.match(response.headers.get("access-control-allow-headers"), /authorization/i);
  const preview = await fetch(`${baseUrl}/api/auth/register`, { method: "OPTIONS", headers: { Origin: "https://menu-app-git-preview-abdul-rehman-abe3.vercel.app", "Access-Control-Request-Method": "POST" } });
  assert.equal(preview.status, 204);
  assert.equal(preview.headers.get("access-control-allow-origin"), "https://menu-app-git-preview-abdul-rehman-abe3.vercel.app");
  const untrusted = await fetch(`${baseUrl}/api/auth/register`, { method: "OPTIONS", headers: { Origin: "https://unrelated.vercel.app", "Access-Control-Request-Method": "POST" } });
  assert.equal(untrusted.status, 403);
  assert.equal(untrusted.headers.get("access-control-allow-origin"), null);
});

test("health and security headers report actual backend state", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, service: "restaurant-saas-api", database: "disconnected" });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("public restaurant response omits owner and subscription internals", async () => {
  const response = await fetch(`${baseUrl}/api/r/test-kitchen`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.name, "Test Kitchen");
  assert.equal(data.ownerId, undefined);
  assert.equal(data.plan, undefined);
  assert.equal(data.subscriptionStatus, undefined);
  assert.equal(data.menu[0].items[0]._id, productId.toString());
});

test("customer orders use server prices and totals and persist a tenant id", async () => {
  const response = await fetch(`${baseUrl}/api/r/test-kitchen/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fulfillment: "delivery", customer: { name: "Customer", phone: "+1 555 0100", address: "1 Test Street" }, items: [{ productId: productId.toString(), quantity: 2, price: 0.01 }] }) });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.order.total, 270);
  assert.equal(createdOrder.restaurantId.toString(), restaurantId.toString());
  assert.equal(createdOrder.items[0].unitPrice, 100);
  assert.equal(createdOrder.items[0].quantity, 2);
});

test("owner login verifies password hashes and registration rejects malformed field types", async () => {
  const badRegistration = await fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: 42, email: "bad@example.test", password: "long-enough-password", restaurantName: {}, slug: "bad-slug" }) });
  assert.equal(badRegistration.status, 400);
  let response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ownerUser.email, password: "test-password-123" }) });
  assert.equal(response.status, 200);
  const login = await response.json();
  assert.equal(login.user.role, "owner");
  assert.equal(login.restaurant.slug, "test-kitchen");
  response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: ownerUser.email, password: "incorrect-password" }) });
  assert.equal(response.status, 401);
});

test("admin plan, platform setting, and audit endpoints are role protected and expose safe defaults", async () => {
  let response = await fetch(`${baseUrl}/api/admin/subscription-plans`);
  assert.equal(response.status, 401);
  response = await fetch(`${baseUrl}/api/admin/subscription-plans`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  const plans = await response.json();
  assert.deepEqual(plans.plans.map((plan) => plan.key), ["free", "basic", "professional", "premium"]);
  response = await fetch(`${baseUrl}/api/admin/settings`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(response.status, 403);
  response = await fetch(`${baseUrl}/api/admin/settings`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.find((setting) => setting.key === "ownerRegistrationEnabled").value, true);
  response = await fetch(`${baseUrl}/api/admin/audit-logs`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).logs, []);
  response = await fetch(`${baseUrl}/api/admin/settings/maintenanceMode`, { method: "PATCH", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ value: true }) });
  assert.equal(response.status, 200);
  response = await fetch(`${baseUrl}/api/r/test-kitchen`);
  assert.equal(response.status, 503);
  response = await fetch(`${baseUrl}/api/admin/subscription-plans`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  await fetch(`${baseUrl}/api/admin/settings/maintenanceMode`, { method: "PATCH", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ value: false }) });
});

test("owner APIs require an active owner session and keep queries tenant-scoped", async () => {
  let response = await fetch(`${baseUrl}/api/owner/orders`);
  assert.equal(response.status, 401);
  response = await fetch(`${baseUrl}/api/owner/orders`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 403);
  response = await fetch(`${baseUrl}/api/owner/orders`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(response.status, 200);
  assert.equal(capturedRestaurantFilter._id.toString(), restaurantId.toString());
  assert.equal(capturedOrderFilter.restaurantId.toString(), restaurantId.toString());
  response = await fetch(`${baseUrl}/api/owner/orders/${new mongoose.Types.ObjectId()}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(response.status, 404);
  assert.equal(capturedOrderDetailFilter.restaurantId.toString(), restaurantId.toString());
  restaurantActive = false;
  response = await fetch(`${baseUrl}/api/owner/orders`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(response.status, 404);
  restaurantActive = true;
});

test("multipart uploads accept valid JPEG, PNG, and WebP data and return a secure URL", async () => {
  const images = [
    ["JPEG", Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"],
    ["PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    ["WebP", Buffer.from("RIFF0000WEBP"), "image/webp"],
  ];
  for (const [label, bytes, type] of images) {
    const response = await sendImage({ bytes, type });
    const body = await response.json();
    assert.equal(response.status, 201, label);
    assert.equal(body.success, true);
    assert.equal(new URL(body.secure_url).protocol, "https:");
    assert.equal(body.public_id, imageResult.public_id);
    assert.equal(body.message, "Image uploaded successfully");
  }
  assert.equal(cloudinaryCalls, 3);
});

test("upload rejects missing files, wrong multipart field, unsupported types, spoofed contents, and oversized files", async () => {
  let response = await sendImage({ bytes: null });
  assert.equal(response.status, 400);
  response = await sendImage({ bytes: Buffer.from("abc"), field: "image" });
  assert.equal(response.status, 400);
  response = await sendImage({ bytes: Buffer.from("GIF89a"), type: "image/gif" });
  assert.equal(response.status, 400);
  response = await sendImage({ bytes: Buffer.from("not a png"), type: "image/png" });
  assert.equal(response.status, 400);
  response = await sendImage({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1), type: "image/jpeg" });
  assert.equal(response.status, 413);
});

test("upload requires owner auth and handles Cloudinary/configuration failures safely", async () => {
  let response = await sendImage({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), token: "" });
  assert.equal(response.status, 401);
  cloudinaryFailure = true;
  response = await sendImage({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  assert.equal(response.status, 502);
  cloudinaryFailure = false;
  const secret = process.env.CLOUDINARY_API_SECRET;
  process.env.CLOUDINARY_API_SECRET = "";
  response = await sendImage({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  assert.equal(response.status, 503);
  process.env.CLOUDINARY_API_SECRET = secret;
});

test("menu save stores the uploaded HTTPS URL on the restaurant menu", async () => {
  const menu = [{ category: "Food", items: [{ name: "Rice", price: 100, image: imageResult.secure_url }] }];
  const response = await fetch(`${baseUrl}/api/owner/menu`, { method: "PUT", headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ menu }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).menu[0].items[0].image, imageResult.secure_url);
});

test("invalid token issuer and invalid route identifiers fail with 401/400", async () => {
  const badIssuer = jwt.sign({ sub: ownerUser.id, role: "owner" }, process.env.JWT_SECRET, { issuer: "other-service" });
  let response = await fetch(`${baseUrl}/api/owner/orders`, { headers: { Authorization: `Bearer ${badIssuer}` } });
  assert.equal(response.status, 401);
  response = await fetch(`${baseUrl}/api/owner/orders/not-an-id/status`, { method: "PATCH", headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "confirmed" }) });
  assert.equal(response.status, 400);
});
