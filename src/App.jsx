import { useEffect, useMemo, useState } from "react";
import { restaurant as demoRestaurant, menu as demoMenu } from "./data/menu.js";
import Hero from "./components/Hero.jsx";
import CartSheet from "./components/CartSheet.jsx";
import OwnerPanel from "./pages/OwnerPanel.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import { request } from "./services/api.js";

const slugFromPath = () => window.location.pathname.match(/^\/r\/([^/]+)/)?.[1] || "chai-corner";
const slug = slugFromPath();
const loadCart = () => { try { return JSON.parse(localStorage.getItem(`cart:${slug}`) || "{}"); } catch { return {}; } };

function Thumb({ item }) { return item.image ? <img src={item.image} alt={item.name} className="size-20 shrink-0 rounded-2xl object-cover" /> : <div className="grid size-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-marigold/30 to-marigold/5 text-4xl">{item.emoji}</div>; }

export default function App() {
  if (window.location.pathname.startsWith("/owner")) return <OwnerPanel />;
  if (window.location.pathname.startsWith("/admin")) return <AdminPanel />;
  const [r, setR] = useState(demoRestaurant); const [menu, setMenu] = useState(demoMenu); const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("All"); const [query, setQuery] = useState(""); const [cart, setCart] = useState(loadCart); const [open, setOpen] = useState(false); const [placed, setPlaced] = useState(null);
  useEffect(() => { request(`/api/r/${slug}`).then((data) => { setR(data); setMenu(data.menu); }).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => { try { localStorage.setItem(`cart:${slug}`, JSON.stringify(cart)); } catch {} }, [cart]);
  const all = useMemo(() => menu.flatMap((c) => c.items), [menu]); const lines = all.filter((i) => cart[i.id ?? i._id]);
  const itemId = (item) => item.id ?? item._id;
  const total = lines.reduce((sum, item) => sum + item.price * cart[itemId(item)], 0); const count = lines.reduce((sum, item) => sum + cart[itemId(item)], 0);
  const change = (id, delta) => setCart((current) => { const qty = Math.max(0, (current[id] || 0) + delta); const next = { ...current, [id]: qty }; if (!qty) delete next[id]; return next; });
  const q = query.trim().toLowerCase();
  const sections = menu.filter((c) => active === "All" || c.category === active).map((c) => ({ ...c, items: c.items.filter((item) => !q || `${item.name} ${item.desc}`.toLowerCase().includes(q)) })).filter((c) => c.items.length);
  const addToCart = (item) => change(itemId(item), 1);
  return <div className="mx-auto max-w-xl pb-32">
    <Hero r={r} />
    <div className="sticky top-0 z-10 bg-mist/90 px-5 pb-2 pt-4 backdrop-blur"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the menu…" aria-label="Search menu" className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm outline-none focus:border-leaf" /><div className="mt-3 flex gap-2 overflow-x-auto pb-1">{[{ category: "All", emoji: "✦" }, ...menu].map((c) => <button key={c.category} onClick={() => setActive(c.category)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${active === c.category ? "bg-ink text-white" : "bg-white text-ink"}`}>{c.emoji} {c.category}</button>)}</div></div>
    <main className="px-5">{loading && <div className="py-4 text-center text-xs text-ink/45">Connecting to the restaurant menu…</div>}{!loading && !sections.length && <p className="py-16 text-center text-ink/60">No dishes match. Try another search.</p>}{sections.map((c) => <section key={c.category} className="mt-5"><h2 className="font-display text-xl font-bold">{c.category}</h2><ul className="mt-2 space-y-3">{c.items.map((item) => { const id = itemId(item); return <li key={id} className="flex gap-4 rounded-3xl bg-white p-3 shadow-[0_1px_0_var(--color-line)]"><Thumb item={item} /><div className="flex min-w-0 flex-1 flex-col"><div className="flex items-center gap-2"><p className="truncate font-semibold">{item.name}</p>{item.popular && <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs font-semibold text-rose">Popular</span>}</div><p className="text-sm text-ink/60">{item.desc}</p><div className="mt-auto flex items-center justify-between pt-2"><span className="font-bold tabular-nums">{r.currency} {item.price}</span>{cart[id] ? <div className="flex items-center gap-3"><button onClick={() => change(id, -1)} className="size-8 rounded-full border border-line" aria-label={`Remove one ${item.name}`}>−</button><span className="w-4 text-center tabular-nums">{cart[id]}</span><button onClick={() => change(id, 1)} className="size-8 rounded-full bg-leaf text-white" aria-label={`Add one ${item.name}`}>+</button></div> : <button onClick={() => addToCart(item)} disabled={item.available === false} className="rounded-full bg-marigold px-5 py-1.5 text-sm font-bold text-ink disabled:opacity-40">Add</button>}</div></div></li>; })}</ul></section>)}</main>
    {count > 0 && <div className="fixed inset-x-0 bottom-0 z-20 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button onClick={() => setOpen(true)} className="pop mx-auto flex w-full max-w-xl items-center justify-between rounded-2xl bg-ink px-5 py-4 text-white shadow-xl"><span className="flex items-center gap-3 font-semibold"><span className="grid size-7 place-items-center rounded-full bg-marigold text-sm font-bold text-ink">{count}</span>View order</span><span className="font-bold tabular-nums">{r.currency} {total}</span></button></div>}
    {open && count > 0 && <CartSheet r={r} slug={slug} lines={lines} cart={cart} change={change} total={total} onClose={() => setOpen(false)} onClear={() => { setCart({}); setOpen(false); }} onPlaced={(order) => { setPlaced(order); setCart({}); setOpen(false); }} />}
    {placed && <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-5"><section role="dialog" aria-modal="true" className="w-full max-w-md rounded-3xl bg-white p-7 text-center shadow-2xl"><div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700">✓</div><p className="mt-4 text-xs font-bold uppercase tracking-widest text-leaf">Order placed</p><h2 className="mt-2 font-display text-2xl font-bold">Thanks, {placed.orderNumber}</h2><p className="mt-2 text-sm text-ink/60">Your order was saved and is awaiting restaurant confirmation. We have not marked it as accepted.</p><p className="mt-4 text-lg font-bold">{placed.currency} {placed.total}</p>{r.whatsapp && <button onClick={() => { const text = `Order ${placed.orderNumber} · ${r.name}\n${placed.items.map((i) => `${i.quantity} × ${i.name}`).join("\n")}\n${placed.fulfillment} · ${placed.customerName} · ${placed.phone}\nTotal: ${placed.currency} ${placed.total}`; window.open(`https://wa.me/${r.whatsapp}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer"); }} className="mt-5 w-full rounded-xl border border-line py-3 font-semibold">Share order details on WhatsApp</button>}<button onClick={() => setPlaced(null)} className="mt-3 w-full rounded-xl bg-ink py-3 font-semibold text-white">Back to menu</button></section></div>}
    <footer className="px-5 py-8 text-center text-xs text-ink/45"><a href="/owner" className="underline underline-offset-4">Restaurant owner sign in</a></footer>
  </div>;
}
