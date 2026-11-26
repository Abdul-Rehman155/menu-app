// Development fallback menu. Live restaurant data is loaded from the API.
export const restaurant = {
  name: "Chai Corner", tagline: "Fresh chai and local favourites", area: "Model Town, Lahore",
  eta: "20–30 min", hours: "Daily · 8am–12am", whatsapp: "923001234567", currency: "Rs",
  deliveryEnabled: true, pickupEnabled: true, dineInEnabled: true, deliveryFee: 0,
};

export const menu = [
  { category: "Chai", emoji: "☕", items: [
    { id: 1, name: "Doodh Patti", price: 120, desc: "Slow brewed and full bodied", emoji: "☕", popular: true },
    { id: 2, name: "Kashmiri Chai", price: 220, desc: "Pink tea with almonds", emoji: "🌸" },
    { id: 3, name: "Masala Chai", price: 150, desc: "Ginger and cardamom", emoji: "🫖" },
  ] },
  { category: "Snacks", emoji: "🥟", items: [
    { id: 4, name: "Samosa (2 pcs)", price: 100, desc: "Crispy potato filling", emoji: "🥟", popular: true },
    { id: 5, name: "Bun Kabab", price: 180, desc: "Served with chutney", emoji: "🍔" },
    { id: 6, name: "Club Sandwich", price: 350, desc: "Chicken with fries", emoji: "🥪" },
  ] },
  { category: "Dessert", emoji: "🍰", items: [
    { id: 7, name: "Gulab Jamun (2)", price: 140, desc: "Warm and syrupy", emoji: "🍮" },
    { id: 8, name: "Brownie", price: 200, desc: "Soft chocolate brownie", emoji: "🍫" },
  ] },
];
