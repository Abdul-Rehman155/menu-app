import { useState } from "react";

const TYPES = [
  { id: "Delivery", label: "Delivery", ask: "Address" },
  { id: "Pickup", label: "Pickup", ask: null },
  { id: "Dine-in", label: "Dine-in", ask: "Table number" },
];

export default function CartSheet({ r, lines, cart, change, total, onClose, onClear }) {
  const [type, setType] = useState("Delivery");
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const ask = TYPES.find((t) => t.id === type).ask;
  const ready = name.trim() && (!ask || place.trim());

  const send = () => {
    const text =
      `*Naya order - ${r.name}*\n\n` +
      lines.map((i) => `${cart[i.id]} x ${i.name} = ${r.currency} ${i.price * cart[i.id]}`).join("\n") +
      `\n\n*Total: ${r.currency} ${total}*\n\nType: ${type}\nNaam: ${name.trim()}` +
      (ask ? `\n${ask}: ${place.trim()}` : "") +
      (note.trim() ? `\nNote: ${note.trim()}` : "");
    window.open(`https://wa.me/${r.whatsapp}?text=${encodeURIComponent(text)}`, "_blank");
  };

  const field = "w-full rounded-xl border border-line bg-mist px-4 py-3 text-sm outline-none focus:border-leaf";

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 fade" onClick={onClose}>
      <div className="sheet max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">Aapka order</h2>
          <button onClick={onClose} className="size-9 rounded-full bg-mist" aria-label="Band karo">✕</button>
        </div>

        <ul className="mt-3 divide-y divide-line">
          {lines.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">{i.emoji} {i.name}</p>
                <p className="text-sm text-ink/60 tabular-nums">{r.currency} {i.price * cart[i.id]}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => change(i.id, -1)} className="size-8 rounded-full border border-line">-</button>
                <span className="w-4 text-center tabular-nums">{cart[i.id]}</span>
                <button onClick={() => change(i.id, 1)} className="size-8 rounded-full bg-leaf text-white">+</button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1">
          {TYPES.map((t) => (
            <button key={t.id} onClick={() => setType(t.id)} className={`rounded-lg py-2 text-sm font-medium ${type === t.id ? "bg-ink text-white" : ""}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-2">
          <input className={field} placeholder="Aapka naam" value={name} onChange={(e) => setName(e.target.value)} />
          {ask && <input className={field} placeholder={ask} value={place} onChange={(e) => setPlace(e.target.value)} />}
          <input className={field} placeholder="Koi note? (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="mt-4 flex items-center justify-between text-lg font-bold">
          <span>Total</span>
          <span className="tabular-nums">{r.currency} {total}</span>
        </div>

        <button onClick={send} disabled={!ready} className="mt-3 w-full rounded-2xl bg-[#25D366] py-3.5 font-semibold text-ink disabled:opacity-40">
          WhatsApp pe order bhejo
        </button>
        <button onClick={onClear} className="mt-2 w-full py-2 text-sm text-ink/60">Cart khali karo</button>
      </div>
    </div>
  );
}