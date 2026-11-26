// Naye restaurant ke liye sirf ye file badlo.
// Photo lagani ho to item me image: "https://..." ya "/photos/chai.jpg" daalo, warna emoji dikhega.
export const restaurant = {
  name: "Chai Corner",
  tagline: "Garam chai, taaza snacks",
  area: "Model Town, Lahore",
  rating: "4.6",
  eta: "20-30 min",
  hours: "Roz 8am se 12am tak",
  whatsapp: "923001234567", // country code ke saath, bina + ke
  currency: "Rs",
};

export const menu = [
  { category: "Chai", emoji: "☕", items: [
    { id: 1, name: "Doodh Patti", price: 120, desc: "Kadak, dhimi aanch pe bani", emoji: "☕", popular: true },
    { id: 2, name: "Kashmiri Chai", price: 220, desc: "Gulabi, badam ke saath", emoji: "🌸" },
    { id: 3, name: "Masala Chai", price: 150, desc: "Adrak aur elaichi", emoji: "🫖" },
  ]},
  { category: "Snacks", emoji: "🥟", items: [
    { id: 4, name: "Samosa (2 pcs)", price: 100, desc: "Aloo, crispy", emoji: "🥟", popular: true },
    { id: 5, name: "Bun Kabab", price: 180, desc: "Chutney ke saath", emoji: "🍔" },
    { id: 6, name: "Club Sandwich", price: 350, desc: "Chicken, fries ke saath", emoji: "🥪" },
  ]},
  { category: "Meetha", emoji: "🍰", items: [
    { id: 7, name: "Gulab Jamun (2)", price: 140, desc: "Garam, sheere me", emoji: "🍮" },
    { id: 8, name: "Brownie", price: 200, desc: "Chocolate, soft", emoji: "🍫" },
  ]},
];