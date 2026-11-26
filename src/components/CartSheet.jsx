import { useState } from "react";
import { request } from "../services/api.js";

const TYPES = [
  { id: "delivery", label: "Delivery", ask: "Delivery address" },
  { id: "pickup", label: "Pickup", ask: null },
  { id: "dine-in", label: "Dine-in", ask: "Table number" },
];
const itemKey = (item) => item.id ?? item._id;

export default function CartSheet({ r, slug, lines, cart, change, total, onClose, onClear, onPlaced }) {
  const [type, setType] = useState(() => r.deliveryEnabled === false ? (r.pickupEnabled === false ? "dine-in" : "pickup") : "delivery");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabledTypes = TYPES.filter((option) => r[`${option.id === "dine-in" ? "dineIn" : option.id}Enabled`] !== false);
  const tax = Number((total * Number(r.taxPercent || 0) / 100).toFixed(2));
  const deliveryFee = type === "delivery" ? Number(r.deliveryFee || 0) : 0;
  const orderTotal = total + tax + deliveryFee;
  const ask = TYPES.find((t) => t.id === type).ask;
  const ready = enabledTypes.some((option) => option.id === type) && name.trim() && /^\+?[0-9 ()-]{7,20}$/.test(phone) && (!ask || place.trim()) && total >= Number(r.minOrderAmount || 0);
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const result = await request(`/api/r/${slug}/orders`, { method: "POST", body: JSON.stringify({ fulfillment: type, customer: { name, phone, ...(type === "delivery" ? { address: place } : {}), ...(type === "dine-in" ? { tableNumber: place } : {}), notes: note }, items: lines.map((item) => ({ productId: itemKey(item), quantity: cart[itemKey(item)] })) }) });
      onPlaced({ ...result.order, fulfillment: type, customerName: name.trim(), phone, items: lines.map((item) => ({ name: item.name, quantity: cart[itemKey(item)] })) });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const field = "w-full rounded-xl border border-line bg-mist px-4 py-3 text-sm outline-none focus:border-leaf";
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 fade" onClick={onClose}>
      <div className="sheet max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h2 className="font-display text-2xl font-bold">Your order</h2><p className="text-sm text-ink/60">Review your items and place an order</p></div><button onClick={onClose} className="size-9 rounded-full bg-mist" aria-label="Close">×</button></div>
        <ul className="mt-3 divide-y divide-line">{lines.map((i) => { const id = itemKey(i); return <li key={id} className="flex items-center justify-between gap-3 py-3"><div><p className="font-medium">{i.emoji} {i.name}</p><p className="text-sm text-ink/60 tabular-nums">{r.currency} {i.price * cart[id]}</p></div><div className="flex items-center gap-3"><button onClick={() => change(id, -1)} className="size-8 rounded-full border border-line" aria-label={`Remove one ${i.name}`}>−</button><span className="w-4 text-center tabular-nums">{cart[id]}</span><button onClick={() => change(id, 1)} className="size-8 rounded-full bg-leaf text-white" aria-label={`Add one ${i.name}`}>+</button></div></li>; })}</ul>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1">{enabledTypes.map((t) => <button key={t.id} onClick={() => setType(t.id)} className={`rounded-lg py-2 text-sm font-medium ${type === t.id ? "bg-ink text-white" : ""}`}>{t.label}</button>)}</div>
        <div className="mt-3 space-y-2"><input className={field} autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} /><input className={field} autoComplete="tel" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />{ask && <input className={field} placeholder={ask} value={place} onChange={(e) => setPlace(e.target.value)} />}<textarea className={field} placeholder="Order notes (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{r.currency} {total}</span></div>{Number(r.taxPercent) > 0 && <div className="flex justify-between"><span>Tax ({r.taxPercent}%)</span><span>{r.currency} {tax}</span></div>}{deliveryFee > 0 && <div className="flex justify-between"><span>Delivery charge</span><span>{r.currency} {deliveryFee}</span></div>}<div className="flex justify-between pt-1 text-lg font-bold"><span>Total</span><span className="tabular-nums">{r.currency} {orderTotal}</span></div>{Number(r.minOrderAmount) > 0 && total < Number(r.minOrderAmount) && <p className="pt-1 text-xs text-rose">Minimum order is {r.currency} {r.minOrderAmount}</p>}</div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-rose/10 p-3 text-sm text-rose">{error}</p>}
        <button onClick={submit} disabled={!ready || busy} className="mt-3 w-full rounded-2xl bg-marigold py-3.5 font-semibold text-ink disabled:opacity-40">{busy ? "Placing order…" : "Place order"}</button>
        <button onClick={onClear} className="mt-2 w-full py-2 text-sm text-ink/60">Clear cart</button>
      </div>
    </div>
  );
}
