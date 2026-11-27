const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim();
// Localhost is only a development default. A deployed browser must never call its own machine for the API.
export const API_URL = (configuredApiUrl || (import.meta.env.DEV ? "http://localhost:5000" : "")).replace(/\/$/, "");

export async function request(path, { token, ...options } = {}) {
  if (!API_URL) throw new Error("Backend URL is not configured. Set VITE_API_URL in your Vercel project to the deployed API URL, then redeploy.");
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}
