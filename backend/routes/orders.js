// backend/routes/orders.js
// ------------------------------------------------------------
// Public-facing order endpoints (API spec Section 2.4–2.5).
//
// Every order records HOW the customer chose to pay:
//   cod     cash on delivery — the courier collects it
//   online  paid ahead by bank transfer / mobile wallet, to the
//           account details in ONLINE_PAYMENT_INSTRUCTIONS (.env);
//           the admin checks the money arrived and marks it paid
//
// There's no payment gateway behind "online" yet, so payment_status
// stays "unpaid" until an admin marks it paid. When a gateway is
// connected later, this is the place it plugs in: createOrder() would
// return a real payment_url and a webhook would mark the order paid.
// Either way the order starts as "pending".
// ------------------------------------------------------------

const PAYMENT_METHODS = ["cod", "online"];

// Shown to customers who chose to pay online. Free text set by the shop
// owner (account title, bank/IBAN, wallet number...). Read on every call
// so changing .env and restarting is all it takes.
function onlinePaymentInstructions() {
  // A .env line can't contain line breaks, so "\n" written in it means one.
  const text = (process.env.ONLINE_PAYMENT_INSTRUCTIONS || "").replace(/\\n/g, "\n").trim();
  return text || null;
}

const { getActiveBookings, getBuyAvailability, rangesOverlap } = require("./items");
const { randomId, uniqueId, transaction, isValidEmail, isValidDate } = require("./util");
const mailer = require("../mailer");
const life = require("./order-lifecycle");
const { deliveryFeeFor } = require("./site");

function createOrder(db, body) {
  const errors = validateOrderInput(body);
  if (errors) return { error: errors };

  // Orders are only ever placed against what the shop is showing, so look the
  // item up through the same public view the catalog uses. That one rule covers
  // unpublished pieces and pieces someone has already bought.
  const item = db.prepare("SELECT * FROM public_items WHERE id = ?").get(body.item_id);
  if (!item) {
    // Distinguish "someone just bought it" (the shopper's page was open while it
    // sold) from "never existed / not for sale", so they get a clear message.
    const purchased = db
      .prepare("SELECT 1 FROM orders WHERE item_id = ? AND type = 'buy' AND status != 'cancelled'")
      .get(body.item_id);
    if (purchased) {
      return { status: 409, error: { code: "item_sold", message: "Someone else just bought this piece, so it's no longer available." } };
    }
    return { status: 404, error: { code: "item_not_found", message: "That item isn't currently available." } };
  }
  if (body.type === "rent" && item.buy_only) {
    return { status: 422, error: { code: "invalid_type", message: "This item is buy-only." } };
  }
  if (body.type === "buy" && item.rent_only) {
    return { status: 422, error: { code: "invalid_type", message: "This item is rent-only." } };
  }

  let priceTotal;
  let delayedDelivery = null; // set when a purchase has to wait for a rental to finish
  if (body.type === "rent") {
    if (body.rent_end_date < body.rent_start_date) {
      return { status: 422, error: { code: "invalid_date_range", message: "End date must be on or after the start date." } };
    }
    if (body.rent_start_date < life.shopToday()) {
      return { status: 422, error: { code: "invalid_date_range", message: "A rental can't start in the past." } };
    }
    const bookings = getActiveBookings(db, item.id);
    const conflict = bookings.find((b) =>
      rangesOverlap(body.rent_start_date, body.rent_end_date, b.rent_start_date, b.rent_end_date)
    );
    if (conflict) {
      return {
        status: 409,
        error: { code: "item_unavailable", message: "Those dates overlap an existing booking." },
      };
    }
    const days = Math.round((new Date(body.rent_end_date) - new Date(body.rent_start_date)) / 86400000) + 1;
    priceTotal = item.rent_price_per_day * days;
  } else {
    // Rental dates are checked first. A piece that's booked for rental (or
    // out with a renter) can still be bought, but it can't be delivered until
    // the rentals finish — so the buyer has to have been told, and say so,
    // before the order is accepted. (The page shows the message at checkout;
    // this is the server-side guarantee, e.g. when a rental was booked after
    // the buyer's page loaded and they never saw it.)
    const hold = getBuyAvailability(db, item.id);
    if (!hold.available) {
      if (body.acknowledge_delayed_delivery !== true) {
        return {
          status: 409,
          error: {
            code: "delivery_delayed",
            message: hold.available_from
              ? `This piece is booked for rental until ${hold.available_from}, so it can't leave us before ${hold.available_from}. Please confirm you're happy to receive it after that.`
              : "This piece is out on rental right now, so it will be delivered once it's back. Please confirm you're happy to wait.",
          },
        };
      }
      delayedDelivery = { deliver_after: hold.available_from };
    }
    priceTotal = item.buy_price;
  }

  // Delivery is charged on top of the items (set in .env; the server decides, never the browser).
  const itemsTotal = priceTotal;
  const deliveryFee = deliveryFeeFor(itemsTotal);
  priceTotal = itemsTotal + deliveryFee;

  // Customer, order, and first history row go in together or not at all.
  let notifyNote = null;
  const orderId = transaction(db, () => {
    const customerId = uniqueId(db, "customers", "cust");
    const newOrderId = uniqueId(db, "orders", "ord");

    db.prepare(
      `INSERT INTO customers (id, name, email, phone, shipping_address) VALUES (?, ?, ?, ?, ?)`
    ).run(customerId, body.customer.name, body.customer.email, body.customer.phone || null, body.customer.shipping_address);

    db.prepare(
      `INSERT INTO orders (id, item_id, customer_id, type, status, rent_start_date, rent_end_date, price_total, delivery_fee, payment_status, payment_method, delivery_held, deliver_after)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, 'unpaid', ?, ?, ?)`
    ).run(
      newOrderId, item.id, customerId, body.type, body.rent_start_date || null, body.rent_end_date || null, priceTotal, deliveryFee,
      body.payment_method, delayedDelivery ? 1 : 0, delayedDelivery ? delayedDelivery.deliver_after : null
    );

    const notes = [];
    notes.push(body.payment_method === "cod" ? "Customer chose cash on delivery." : "Customer chose to pay online — waiting for the transfer.");
    if (delayedDelivery) {
      notes.push(
        delayedDelivery.deliver_after
          ? `Buyer agreed to delivery after the current rental — do not ship before ${delayedDelivery.deliver_after}.`
          : "Buyer agreed to delivery after the current rental returns — hold the shipment until it's back."
      );
    }
    const historyNote = notes.join(" ");
    db.prepare(`INSERT INTO order_status_history (id, order_id, status, note) VALUES (?, ?, 'pending', ?)`).run(
      randomId("hist"),
      newOrderId,
      historyNote
    );
    notifyNote = historyNote;
    return newOrderId;
  });

  // Tell the owner (in the background; never affects the shopper's response).
  mailer.notifyNewOrder({
    order: { id: orderId, type: body.type, rent_start_date: body.rent_start_date, rent_end_date: body.rent_end_date, price_total: priceTotal, delivery_fee: deliveryFee, payment_method: body.payment_method },
    item,
    customer: body.customer,
    note: notifyNote,
  });
  mailer.customerOrderPlaced({
    order: { id: orderId, type: body.type, rent_start_date: body.rent_start_date, rent_end_date: body.rent_end_date, price_total: priceTotal, delivery_fee: deliveryFee, payment_method: body.payment_method },
    itemName: item.name,
    customer: body.customer,
    deliverAfter: delayedDelivery ? delayedDelivery.deliver_after || null : undefined,
  });

  return {
    status: 201,
    body: {
      order_id: orderId,
      status: "pending",
      price_total: priceTotal,
      items_total: itemsTotal,
      delivery_fee: deliveryFee,
      deposit_amount: null,
      delivery_delayed: !!delayedDelivery,
      deliver_after: delayedDelivery ? delayedDelivery.deliver_after : null,
      payment_method: body.payment_method,
      payment_status: "unpaid",
      payment_instructions: body.payment_method === "online" ? onlinePaymentInstructions() : null,
      payment_url: null, // no gateway yet — see the note at the top of this file
    },
  };
}

function validateOrderInput(body) {
  if (!body || typeof body !== "object") return { code: "invalid_body", message: "Request body must be JSON." };
  if (!body.item_id) return { code: "invalid_body", message: "item_id is required." };
  if (body.type !== "rent" && body.type !== "buy") return { code: "invalid_body", message: "type must be 'rent' or 'buy'." };
  if (!PAYMENT_METHODS.includes(body.payment_method)) {
    return { code: "invalid_payment_method", message: "payment_method must be 'cod' (cash on delivery) or 'online'." };
  }

  const c = body.customer;
  if (!c || !c.name || !c.email || !c.shipping_address) {
    return { code: "invalid_body", message: "customer.name, customer.email, and customer.shipping_address are required." };
  }
  if (!isValidEmail(c.email)) return { code: "invalid_body", message: "customer.email is not a valid email." };

  if (body.type === "rent") {
    if (!isValidDate(body.rent_start_date) || !isValidDate(body.rent_end_date)) {
      return { code: "invalid_body", message: "rent_start_date and rent_end_date are required (YYYY-MM-DD) for rentals." };
    }
  }
  return null;
}

function getOrder(db, id, email) {
  if (!email) return null;

  const row = db
    .prepare(
      `SELECT o.id, o.type, o.status, o.rent_end_date, o.delivery_held, o.deliver_after, o.price_total, o.delivery_fee, o.payment_method, o.payment_status,
              o.refund_status, o.late_fee, o.damage_fee, o.charges_status, o.cancelled_by,
              i.name as item_name, i.rent_price_per_day, c.email as customer_email
       FROM orders o
       JOIN items i ON i.id = o.item_id
       JOIN customers c ON c.id = o.customer_id
       WHERE lower(o.id) = lower(?)`
    )
    .get(id);

  // Same response whether the order doesn't exist or the email just
  // doesn't match — an attacker shouldn't be able to tell which.
  if (!row || row.customer_email.toLowerCase() !== email.toLowerCase()) return null;

  const shipment = db
    .prepare(`SELECT courier, tracking_number, status FROM shipments WHERE order_id = ? AND direction = 'outbound'`)
    .get(row.id);

  return {
    order_id: row.id,
    item_name: row.item_name,
    type: row.type,
    status: row.status,
    rent_end_date: row.rent_end_date,
    delivery_delayed: !!row.delivery_held,
    deliver_after: row.deliver_after || null,
    price_total: row.price_total,
    delivery_fee: row.delivery_fee || 0,
    payment_method: row.payment_method || null,
    payment_status: row.payment_status,
    // Only worth showing while there's still something to pay.
    payment_instructions: row.payment_method === "online" && row.payment_status !== "paid" ? onlinePaymentInstructions() : null,
    // Cancelling, refunds, late returns and charges (see order-lifecycle.js)
    cancellable: life.CANCELLABLE.includes(row.status) && !shipment,
    cancelled_by: row.status === "cancelled" ? row.cancelled_by || null : null,
    refund_status: row.refund_status || null,
    refund_amount: row.refund_status ? row.price_total : null,
    ...(() => {
      const { overdue, days_late, late_fee_accruing } = life.lateness(row, row.rent_price_per_day);
      return { overdue, days_late, late_fee_accruing };
    })(),
    charges: life.charges(row).total > 0 ? life.charges(row) : null,
    tracking: shipment
      ? { carrier: shipment.courier, tracking_number: shipment.tracking_number, status: shipment.status }
      : null,
  };
}

module.exports = { createOrder, getOrder, PAYMENT_METHODS };