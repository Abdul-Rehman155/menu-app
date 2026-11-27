export const defaultPlans = [
  { key: "free", name: "Free", price: null, currency: "USD", billingCycle: "monthly", active: true, sortOrder: 0, limits: { maxCategories: null, maxProducts: null, maxMonthlyOrders: null }, features: { imageUploads: true, analytics: true, reports: true } },
  { key: "basic", name: "Basic", price: null, currency: "USD", billingCycle: "monthly", active: true, sortOrder: 1, limits: { maxCategories: null, maxProducts: null, maxMonthlyOrders: null }, features: { imageUploads: true, analytics: true, reports: true } },
  { key: "professional", name: "Professional", price: null, currency: "USD", billingCycle: "monthly", active: true, sortOrder: 2, limits: { maxCategories: null, maxProducts: null, maxMonthlyOrders: null }, features: { imageUploads: true, analytics: true, reports: true } },
  { key: "premium", name: "Premium", price: null, currency: "USD", billingCycle: "monthly", active: true, sortOrder: 3, limits: { maxCategories: null, maxProducts: null, maxMonthlyOrders: null }, features: { imageUploads: true, analytics: true, reports: true } },
];

export function getPlanDefinition(key, configuredPlan) {
  const aliases = { starter: "basic", pro: "professional" };
  const normalizedKey = aliases[key] || key;
  const fallback = defaultPlans.find((plan) => plan.key === normalizedKey) || defaultPlans[0];
  return configuredPlan ? { ...fallback, ...configuredPlan, limits: { ...fallback.limits, ...configuredPlan.limits }, features: { ...fallback.features, ...configuredPlan.features } } : fallback;
}
