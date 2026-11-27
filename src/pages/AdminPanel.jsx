import { useCallback, useEffect, useState } from "react";
import { request } from "../services/api.js";

export default function AdminPanel() {
  const [token, setToken] = useState(() => localStorage.getItem("platformToken") || "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [data, setData] = useState(null);
  const [restaurants, setRestaurants] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const clearSession = () => {
    localStorage.removeItem("platformToken");
    setToken("");
    setData(null);
    setRestaurants([]);
  };

  const fetchAll = useCallback(async (jwt) => {
    setBusy(true);
    setError("");
    try {
      const [summary, list] = await Promise.all([
        request("/api/admin/overview", { token: jwt }),
        request("/api/admin/restaurants", { token: jwt }),
      ]);
      setData(summary);
      setRestaurants(list.restaurants);
    } catch (fetchError) {
      setError(fetchError.message);
      if (fetchError.status === 401) clearSession();
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (token) fetchAll(token);
  }, [token, fetchAll]);

  const login = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (result.user.role !== "super_admin") throw new Error("This account does not have platform administrator access");
      localStorage.setItem("platformToken", result.token);
      setToken(result.token);
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (id, status) => {
    setBusy(true);
    setError("");
    try {
      await request(`/api/admin/restaurants/${id}/status`, { token, method: "PATCH", body: JSON.stringify({ status }) });
      await fetchAll(token);
    } catch (statusError) {
      setError(statusError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!token) return <div className="grid min-h-screen place-items-center bg-mist p-5"><form onSubmit={login} className="w-full max-w-md rounded-3xl bg-white p-8"><a href="/" className="text-sm text-leaf">← Menu</a><p className="mt-8 text-xs font-bold uppercase tracking-widest text-rose">Platform control</p><h1 className="mt-2 font-display text-3xl font-bold">Super admin</h1><p className="mt-2 text-sm text-ink/60">Sign in with a provisioned administrator account.</p><input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="mt-5 w-full rounded-xl border border-line px-4 py-3" /><input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="mt-3 w-full rounded-xl border border-line px-4 py-3" />{error && <p role="alert" className="mt-3 text-sm text-rose">{error}</p>}<button disabled={busy} className="mt-4 w-full rounded-xl bg-ink py-3 font-semibold text-white">{busy ? "Signing in…" : "Sign in"}</button></form></div>;

  return <main className="min-h-screen bg-mist p-5 md:p-10"><header className="mx-auto flex max-w-6xl items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-rose">Platform control</p><h1 className="mt-1 font-display text-3xl font-bold">Super admin</h1></div><button onClick={clearSession} className="rounded-xl border border-line bg-white px-4 py-2">Sign out</button></header>{error && <p role="alert" className="mx-auto mt-4 max-w-6xl text-sm text-rose">{error}</p>}{busy && !data && <p role="status" className="mx-auto mt-6 max-w-6xl text-sm text-ink/60">Loading platform data…</p>}{data && <div className="mx-auto mt-7 grid max-w-6xl gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Restaurants", data.totalRestaurants], ["Active", data.activeRestaurants], ["Suspended", data.suspendedRestaurants], ["Orders", data.totalOrders]].map(([label, value]) => <article key={label} className="rounded-2xl bg-white p-5"><p className="text-sm text-ink/60">{label}</p><p className="mt-2 font-display text-3xl font-bold">{value}</p></article>)}</div>}<section className="mx-auto mt-7 max-w-6xl rounded-2xl bg-white p-5"><h2 className="font-bold">Restaurants</h2><div className="mt-3 divide-y divide-line">{restaurants.map((r) => <div key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-semibold">{r.name} <span className="font-normal text-ink/50">/{r.slug}</span></p><p className="mt-1 text-xs capitalize text-ink/55">{r.status} · {r.plan} plan · {r.subscriptionStatus}</p></div><button disabled={busy} onClick={() => changeStatus(r._id, r.status === "active" ? "suspended" : "active")} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50">{r.status === "active" ? "Suspend" : "Activate"}</button></div>)}{data && restaurants.length === 0 && <p className="py-6 text-sm text-ink/55">No restaurants found.</p>}</div></section></main>;
}
