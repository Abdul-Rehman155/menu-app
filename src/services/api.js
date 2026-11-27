const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").trim();
// Localhost is only a development default. A deployed browser must never call its own machine for the API.
export const API_URL = (configuredApiUrl || (import.meta.env.DEV ? "http://localhost:5000" : "")).replace(/\/$/, "");
const productionLocalApi = import.meta.env.PROD && /^https?:\/\/(?:localhost(?:\.localdomain)?|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::|\/|$)/i.test(API_URL);
const productionInsecureApi = import.meta.env.PROD && Boolean(API_URL) && !/^https:\/\//i.test(API_URL);

export async function request(path, { token, ...options } = {}) {
  if (productionLocalApi) throw new Error("VITE_API_URL points to localhost. Set it to the deployed Render API URL in Vercel and redeploy.");
  if (productionInsecureApi) throw new Error("Production VITE_API_URL must use HTTPS. Set it to the deployed Render API URL in Vercel and redeploy.");
  if (!API_URL) throw new Error("Backend URL is not configured. Set VITE_API_URL in your Vercel project to the deployed API URL, then redeploy.");
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
