import { useEffect, useMemo, useState } from "react";
import { restaurant as r, menu } from "./data/menu.js";
import Hero from "./components/Hero.jsx";
import CartSheet from "./components/CartSheet.jsx";

const load = () => {
  try { return JSON.parse(localStorage.getItem("cart") || "{}"); } catch { return {}; }
};

function Thumb({ item }) {
  return item.image ? (
    <img src={item.image} alt={item.name} className="size-20 shrink-0 rounded-2xl object-cover" />
  ) : (
    <div className="grid size-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-marigold/30 to-marigold/5 text-4xl">
      {item.emoji}
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState("Sab");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState(load);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem("cart", JSON.stringify(cart)); } catch {}
  }, [cart]);

  const all = useMemo(() => menu.flatMap((c) => c.items), []);
  const lines = all.filter((i) => cart[i.id]);
  const total = lines.reduce((s, i) => s + i.price * cart[i.id], 0);
  const count = lines.reduce((s, i) => s + cart[i.id], 0);

  const change = (id, d) =>
    setCart((c) => {
      const q = Math.max(0, (c[id] || 0) + d);
      const next = { ...c, [id]: q };
      if (!q) delete next[id];
      return next;
    });

  const q = query.trim().toLowerCase();
  const sections = menu
    .filter((c) => active === "Sab" || c.category === active)
    .map((c) => ({ ...c, items: c.items.filter((i) => !q || i.name.toLowerCase().includes(q)) }))
    .filter((c) => c.items.length);

  return (
    <div className="mx-auto max-w-xl pb-32">
      <Hero r={r} />

      <div className="sticky top-0 z-10 bg-mist/90 px-5 pb-2 pt-4 backdrop-blur">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍  Kuch dhoondhein..."
          className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm outline-none focus:border-leaf"
        />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {[{ category: "Sab", emoji: "✨" }, ...menu].map((c) => (
            <button
              key={c.category}
              onClick={() => setActive(c.category)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${active === c.category ? "bg-ink text-white" : "bg-white text-ink"}`}
            >
              {c.emoji} {c.category}
            </button>
          ))}
        </div>
      </div>

      <main className="px-5">
        {sections.length === 0 && <p className="py-16 text-center text-ink/60">Kuch nahi mila. Doosra naam try karein.</p>}
        {sections.map((c) => (
          <section key={c.category} className="mt-5">
            <h2 className="font-display text-xl font-bold">{c.category}</h2>
            <ul className="mt-2 space-y-3">
              {c.items.map((item) => (
                <li key={item.id} className="flex gap-4 rounded-3xl bg-white p-3 shadow-[0_1px_0_var(--color-line)]">
                  <Thumb item={item} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{item.name}</p>
                      {item.popular && <span className="shrink-0 rounded-full bg-rose/10 px-2 py-0.5 text-xs font-semibold text-rose">Mashhoor</span>}
                    </div>
                    <p className="text-sm text-ink/60">{item.desc}</p>
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <span className="font-bold tabular-nums">{r.currency} {item.price}</span>
                      {cart[item.id] ? (
                        <div className="flex items-center gap-3">
                          <button onClick={() => change(item.id, -1)} className="size-8 rounded-full border border-line" aria-label="Kam karo">-</button>
                          <span className="w-4 text-center tabular-nums">{cart[item.id]}</span>
                          <button onClick={() => change(item.id, 1)} className="size-8 rounded-full bg-leaf text-white" aria-label="Zyada karo">+</button>
                        </div>
                      ) : (
                        <button onClick={() => change(item.id, 1)} className="rounded-full bg-marigold px-5 py-1.5 text-sm font-bold text-ink">Add</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            key={count}
            onClick={() => setOpen(true)}
            className="pop mx-auto flex w-full max-w-xl items-center justify-between rounded-2xl bg-ink px-5 py-4 text-white shadow-xl"
          >
            <span className="flex items-center gap-3 font-semibold">
              <span className="grid size-7 place-items-center rounded-full bg-marigold text-sm font-bold text-ink">{count}</span>
              Order dekhein
            </span>
            <span className="font-bold tabular-nums">{r.currency} {total}</span>
          </button>
        </div>
      )}

      {open && count > 0 && (
        <CartSheet r={r} lines={lines} cart={cart} change={change} total={total} onClose={() => setOpen(false)} onClear={() => { setCart({}); setOpen(false); }} />
      )}
    </div>
  );
}