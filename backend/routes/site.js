// backend/routes/site.js
// ------------------------------------------------------------
// Public facts about the shop that pages and emails show: how to reach
// you, and how late fees are worked out. All set in .env, nothing secret.
//   CONTACT_EMAIL     default: NOTIFY_EMAIL, else wearshare300@gmail.com
//   CONTACT_WHATSAPP  optional, e.g. +92 300 1234567
//   CONTACT_PHONE     optional
//   DELIVERY_FEE      flat Rs charge per order for delivery (and collection); default 0
//   FREE_DELIVERY_OVER  items total at or above which delivery is free; optional
// ------------------------------------------------------------

function contact() {
  const clean = (v) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, 80) : "");
  return {
    email: clean(process.env.CONTACT_EMAIL) || clean(process.env.NOTIFY_EMAIL) || "wearshare300@gmail.com",
    whatsapp: clean(process.env.CONTACT_WHATSAPP) || null,
    phone: clean(process.env.CONTACT_PHONE) || null,
  };
}

// Delivery (and collection, for rentals) costs a flat fee per order, set with
// DELIVERY_FEE; orders whose items come to FREE_DELIVERY_OVER or more ship free.
function deliveryConfig() {
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return { fee: num(process.env.DELIVERY_FEE), free_over: num(process.env.FREE_DELIVERY_OVER) };
}

function deliveryFeeFor(itemsTotal) {
  const { fee, free_over } = deliveryConfig();
  if (!fee) return 0;
  return free_over && itemsTotal >= free_over ? 0 : fee;
}

function getSite() {
  const flat = Number(process.env.LATE_FEE_PER_DAY);
  const hasFlat = Number.isFinite(flat) && flat > 0;
  return {
    status: 200,
    body: {
      contact: contact(),
      delivery: deliveryConfig(),
      late_fee: hasFlat ? { mode: "flat", per_day: flat } : { mode: "daily_rent", per_day: null },
    },
  };
}

// One line for the bottom of emails.
function contactLine() {
  const c = contact();
  return `Questions? Write to ${c.email}${c.whatsapp ? ` or WhatsApp ${c.whatsapp}` : ""}${c.phone ? ` or call ${c.phone}` : ""}.`;
}

module.exports = { getSite, contact, contactLine, deliveryFeeFor };