// backend/mailer.js
// ------------------------------------------------------------
// Emails the shop owner when something happens (a new order, a new
// intake, a status change...). Every message goes to ONE address, the
// owner's (NOTIFY_EMAIL); nothing is ever sent to customers or providers,
// so the anonymity rule is untouched.
//
// No npm packages: this speaks a small piece of SMTP itself (TLS, AUTH
// LOGIN, one message at a time). Written for Gmail's SMTP server with an
// "app password"; any SMTP server that takes a login works.
//
// Settings (in .env, see .env.example):
//   SMTP_USER      the account that SENDS the mail (e.g. wearshare300@gmail.com)
//   SMTP_PASS      its app password (NOT the normal Gmail password)
//   NOTIFY_EMAIL   who receives the notifications (default wearshare300@gmail.com)
//   SMTP_HOST / SMTP_PORT / SMTP_SECURE / MAIL_FROM   optional, Gmail by default
//
// Sending never slows down or breaks the website: it happens in the
// background, and a failure is only written to the server log. With no
// SMTP_USER / SMTP_PASS set, nothing is sent and the log says so.
// ------------------------------------------------------------

const net = require("node:net");
const tls = require("node:tls");
const os = require("node:os");

const DEFAULT_TO = "wearshare300@gmail.com";

function settings() {
  const user = process.env.SMTP_USER || "";
  return {
    user,
    pass: (process.env.SMTP_PASS || "").replace(/\s+/g, ""), // Google shows app passwords with spaces
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE !== "false", // "false" = plain socket (local test servers only)
    from: process.env.MAIL_FROM || user,
    to: process.env.NOTIFY_EMAIL || DEFAULT_TO,
  };
}

// Header values can't contain line breaks (that would let text a customer typed
// add headers of its own), and non-ASCII needs RFC 2047 encoding.
const oneLine = (s) => String(s).replace(/[\r\n]+/g, " ").trim();
function encodeHeader(s) {
  s = oneLine(s);
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function buildMessage(cfg, subject, text) {
  const body = Buffer.from(String(text).replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: WearShare <${oneLine(cfg.from)}>`,
    `To: ${oneLine(cfg.to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@wearshare>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

// One SMTP conversation: connect, log in, send one message, quit.
function smtpSend(cfg, subject, text) {
  return new Promise((resolve, reject) => {
    const socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });
    socket.setTimeout(20000, () => done(new Error("SMTP timed out")));

    let buffer = "";
    let waiting = null; // resolver for the next full server reply
    let finished = false;
    function done(err) {
      if (finished) return;
      finished = true;
      socket.destroy();
      err ? reject(err) : resolve();
    }
    socket.on("error", done);
    socket.on("close", () => done(new Error("SMTP connection closed early")));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      // A reply is finished at a line like "250 text" (a space after the code, not a dash).
      const lines = buffer.split("\r\n");
      if (lines.length < 2) return;
      const last = lines[lines.length - 2];
      if (/^\d{3} /.test(last) && waiting) {
        const reply = buffer;
        buffer = "";
        const w = waiting;
        waiting = null;
        w(reply);
      }
    });

    const reply = () => new Promise((r) => (waiting = r));
    const expect = async (codes) => {
      const r = await reply();
      if (!codes.includes(r.slice(0, 3))) throw new Error("SMTP said: " + oneLine(r).slice(0, 200));
    };
    const say = (line) => socket.write(line + "\r\n");

    (async () => {
      await expect(["220"]);
      say(`EHLO ${os.hostname() || "localhost"}`);
      await expect(["250"]);
      say("AUTH LOGIN");
      await expect(["334"]);
      say(Buffer.from(cfg.user).toString("base64"));
      await expect(["334"]);
      say(Buffer.from(cfg.pass).toString("base64"));
      await expect(["235"]);
      say(`MAIL FROM:<${oneLine(cfg.from)}>`);
      await expect(["250"]);
      say(`RCPT TO:<${oneLine(cfg.to)}>`);
      await expect(["250", "251"]);
      say("DATA");
      await expect(["354"]);
      // Lines that start with "." are doubled so they can't end the message early.
      socket.write(buildMessage(cfg, subject, text).replace(/^\./gm, "..") + "\r\n.\r\n");
      await expect(["250"]);
      say("QUIT");
      done();
    })().catch(done);
  });
}

// Messages are sent one at a time, in order, so a burst of events doesn't
// open a pile of connections (Gmail dislikes that).
let chain = Promise.resolve();
let lastSend = Promise.resolve();

function sendMail(subject, text, to) {
  const cfg = { ...settings() };
  if (to) cfg.to = to;
  if (!cfg.user || !cfg.pass) {
    console.log(`[email] not set up, so not sent: ${oneLine(subject)} (add SMTP_USER and SMTP_PASS to .env)`);
    return lastSend;
  }
  lastSend = chain = chain
    .then(() => smtpSend(cfg, subject, text))
    .then(() => console.log(`[email] sent: ${oneLine(subject)}`))
    .catch((err) => console.error(`[email] FAILED (${oneLine(subject)}): ${err.message}`));
  return lastSend;
}

// ---- the actual notifications ---------------------------------------------
// First the ones to the OWNER, then (further down) the ones to CUSTOMERS.

const rs = (n) => "Rs " + Number(n).toLocaleString("en-PK");
const lines = (rows) => rows.filter(Boolean).join("\n");

function notifyNewOrder({ order, item, customer, note }) {
  const rental = order.type === "rent";
  return sendMail(
    `[WearShare] New ${rental ? "rental" : "purchase"} order ${order.id}: ${item.name}`,
    lines([
      `A new order was placed.`,
      ``,
      `Order:    ${order.id}`,
      `Item:     ${item.name} (${item.id})`,
      `Type:     ${rental ? "Rental" : "Purchase"}`,
      rental ? `Dates:    ${order.rent_start_date} to ${order.rent_end_date}` : null,
      order.delivery_fee > 0 ? `Delivery: ${rs(order.delivery_fee)} (included in the total)` : null,
      `Total:    ${rs(order.price_total)}`,
      `Payment:  ${order.payment_method === "cod" ? "Cash on delivery" : "Online (waiting for the transfer)"}, not yet paid`,
      note ? `Note:     ${note}` : null,
      ``,
      `Customer: ${customer.name}`,
      `Email:    ${customer.email}`,
      `Phone:    ${customer.phone || "-"}`,
      `Deliver to: ${customer.shipping_address}`,
    ])
  );
}

function notifyNewIntake({ reference, provider, item, notes }) {
  return sendMail(
    `[WearShare] New intake ${reference}: ${item.name}`,
    lines([
      `Someone wants to send you an item.`,
      ``,
      `Reference: ${reference}`,
      `Item:      ${item.name}`,
      `Category:  ${item.category}   Size: ${item.size}   Condition: ${item.condition}`,
      ``,
      `Provider:  ${provider.name}`,
      `Email:     ${provider.email}`,
      `Phone:     ${provider.phone || "-"}`,
      `Payout details: ${provider.payout_details ? "provided (see admin Payouts)" : "not given"}`,
      ``,
      notes,
      ``,
      `Review it in the admin panel under Listings (status: intake).`,
    ])
  );
}

function notifyOrderStatus({ orderId, itemName, status, note }) {
  return sendMail(
    `[WearShare] Order ${orderId} is now ${status}`,
    lines([`Order ${orderId} (${itemName}) was changed to: ${status}`, note ? `Note: ${note}` : null])
  );
}

function notifyPayment({ orderId, itemName, paid, method, total }) {
  return sendMail(
    `[WearShare] Order ${orderId}: payment ${paid ? "received" : "marked as not received"}`,
    lines([
      `Order ${orderId} (${itemName}): payment ${paid ? "marked as RECEIVED" : "marked as NOT received"}.`,
      `Method: ${method === "cod" ? "Cash on delivery" : method === "online" ? "Online" : "unknown"}   Amount: ${rs(total)}`,
    ])
  );
}

function notifyShipment({ orderId, itemName, direction, courier, trackingNumber }) {
  return sendMail(
    `[WearShare] Order ${orderId}: ${direction} shipment booked`,
    lines([`A ${direction} shipment was booked for order ${orderId} (${itemName}).`, `Courier: ${courier}`, `Tracking number: ${trackingNumber}`])
  );
}

function notifyItemStatus({ itemId, itemName, from, to }) {
  return sendMail(`[WearShare] Listing ${itemName} is now ${to}`, `Listing "${itemName}" (${itemId}) changed from ${from} to ${to}.`);
}

function notifyPayoutPaid({ payoutId, providerName, itemName, amount, orderId }) {
  return sendMail(
    `[WearShare] Payout ${payoutId} marked paid`,
    lines([`A payout was marked as paid.`, `Provider: ${providerName}`, `Item: ${itemName}   Order: ${orderId}`, `Amount: ${rs(amount)}`])
  );
}

// ---- emails to CUSTOMERS ---------------------------------------------------
// From the same account, to the address the customer typed at checkout. They
// only ever contain that customer's own order, and the item's public name;
// nothing about the provider, and never the owner's private order notes.
// Switch them off with CUSTOMER_EMAILS=off.

// A stricter check than the checkout form's, because this one becomes a mail
// recipient: plain addresses only, nothing that could smuggle in a second one.
const MAILABLE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

// example.com / .test / .invalid etc. are reserved: they can never receive mail, so the
// demo data's customers are skipped instead of bouncing back to the owner's inbox.
const RESERVED_DOMAIN = /@([a-z0-9-]+\.)*(example\.(com|org|net)|[a-z0-9-]+\.(test|invalid|localhost|example))$/i;

function sendToCustomer(customer, subject, body) {
  if (String(process.env.CUSTOMER_EMAILS || "").toLowerCase() === "off") return lastSend;
  const to = String((customer && customer.email) || "").trim();
  if (RESERVED_DOMAIN.test(to) && !process.env.ALLOW_RESERVED_EMAIL_DOMAINS) {
    console.log("[email] reserved demo address, so not sent: " + oneLine(subject));
    return lastSend;
  }
  if (!MAILABLE.test(to) || to.length > 254) {
    console.log("[email] customer address looks unusable, so not sent: " + oneLine(subject));
    return lastSend;
  }
  const name = String((customer && customer.name) || "").split(/\s+/)[0] || "there";
  const track = process.env.PUBLIC_URL
    ? `Check on your order any time: ${process.env.PUBLIC_URL.replace(/\/+$/, "")}/track-order.html`
    : `Check on your order any time on the "Track your order" page of the site.`;
  return sendMail(
    subject,
    lines([`Hi ${name},`, ``, body, ``, track, `You'll need your order reference and this email address.`, ``, `Thank you,`, `WearShare`, ``, require("./routes/site").contactLine()]),
    to
  );
}

// ---- Emails to providers (the people who list pieces) ---------------------
// They only ever hear about their own pieces. Never a word about the customer
// (name, address, contact, even which city), and never payout/bank details.
// Same safety rules as customer mail; PROVIDER_EMAILS=off turns them off.
function sendToProvider(provider, subject, body) {
  if (String(process.env.PROVIDER_EMAILS || "").toLowerCase() === "off") return lastSend;
  const to = String((provider && provider.email) || "").trim();
  if (RESERVED_DOMAIN.test(to) && !process.env.ALLOW_RESERVED_EMAIL_DOMAINS) {
    console.log("[email] reserved demo address, so not sent: " + oneLine(subject));
    return lastSend;
  }
  if (!MAILABLE.test(to) || to.length > 254) {
    console.log("[email] provider address looks unusable, so not sent: " + oneLine(subject));
    return lastSend;
  }
  const name = String((provider && provider.name) || "").split(/\s+/)[0] || "there";
  return sendMail(
    subject,
    lines([`Hi ${name},`, ``, body, ``, `Thank you,`, `WearShare`, ``, require("./routes/site").contactLine()]),
    to
  );
}

function providerIntakeReceived({ provider, reference, item, hasPayoutDetails }) {
  return sendToProvider(
    provider,
    `We've received your submission ${reference}`,
    lines([
      `Thank you for sending us "${item.name}". We've got your submission.`,
      ``,
      `Your reference: ${reference}`,
      ``,
      `What happens next: we'll arrange the pickup or drop-off with you, photograph the piece and put it on the site. We'll email you when it's live.`,
      `Renters and buyers never see your name or contact details, and you never see theirs.`,
      ...(hasPayoutDetails ? [] : [``, `You didn't tell us where to send your share of the money. That's fine for now; just reply to this email with your bank or wallet details before your first payout.`]),
    ])
  );
}

function providerItemListed({ provider, itemName }) {
  return sendToProvider(provider, `Your piece is live: ${itemName}`, `Good news: "${itemName}" is now listed on WearShare and people can rent or buy it. We'll email you when someone books it.`);
}

function providerItemBooked({ provider, itemName, type, startDate, endDate, share }) {
  return sendToProvider(
    provider,
    `Your piece has been ${type === "rent" ? "booked" : "bought"}: ${itemName}`,
    lines([
      type === "rent"
        ? `"${itemName}" has been booked for rent${startDate && endDate ? ` from ${startDate} to ${endDate}` : ""}.`
        : `"${itemName}" has been bought.`,
      ``,
      `You don't need to do anything: we handle the delivery${type === "rent" ? " and the return" : ""}.`,
      share > 0 ? `Your share will be ${rs(share)}, paid once the order is complete.` : ``,
    ])
  );
}

function providerPayoutPaid({ provider, itemName, amount, paidAt }) {
  return sendToProvider(
    provider,
    `Your payout has been sent: ${rs(amount)}`,
    lines([`We've sent your payout of ${rs(amount)} for "${itemName}" (marked paid on ${paidAt}).`, `It went to the payment details you gave us. If it doesn't arrive in a few days, reply to this email and we'll look into it.`])
  );
}

function onlineInstructions() {
  return (process.env.ONLINE_PAYMENT_INSTRUCTIONS || "").replace(/\\n/g, "\n").trim();
}

function paymentLines(o) {
  if (o.payment_method === "cod") return [`Payment: cash on delivery. Please keep ${rs(o.price_total)} ready for the courier.`];
  const how = onlineInstructions();
  return [
    `Payment: online. Please send ${rs(o.price_total)} and put your order reference (${o.id}) in the payment note.`,
    how ? `\n${how}` : `We'll message you the payment details shortly.`,
  ];
}

function customerOrderPlaced({ order, itemName, customer, deliverAfter }) {
  const rental = order.type === "rent";
  return sendToCustomer(
    customer,
    `Your WearShare order ${order.id}`,
    lines([
      `We've received your ${rental ? "rental" : "purchase"} order.`,
      ``,
      `Order reference: ${order.id}`,
      `Item: ${itemName}`,
      rental ? `Dates: ${order.rent_start_date} to ${order.rent_end_date}` : null,
      order.delivery_fee > 0 ? `Items: ${rs(order.price_total - order.delivery_fee)}` : null,
      order.delivery_fee > 0 ? `Delivery${rental ? " and collection" : ""}: ${rs(order.delivery_fee)}` : null,
      `Total: ${rs(order.price_total)}`,
      `Deliver to: ${customer.shipping_address}`,
      ``,
      ...paymentLines(order),
      deliverAfter !== undefined
        ? `\nDelivery: this piece is out on rental, so it can't be sent before ${deliverAfter || "its current rental has finished"}.`
        : null,
      ``,
      `We'll email you again as your order moves along.`,
    ])
  );
}

const CUSTOMER_STATUS_TEXT = {
  confirmed: "Your order is confirmed. We're getting it ready.",
  shipped: "Your order is on its way.",
  delivered: "Your order has been delivered. We hope you love it.",
  return_due: "Your rental is due back. Please get it ready for the courier to collect.",
  returned: "We've received your rental back. Thank you.",
  completed: "Your order is complete. Thank you for choosing WearShare.",
  cancelled: "Your order has been cancelled. If you didn't expect this, just reply to this email and we'll sort it out.",
};

function customerStatus({ order, itemName, customer, status }) {
  const text = CUSTOMER_STATUS_TEXT[status];
  if (!text) return lastSend; // "pending" and anything else the customer needn't hear about
  return sendToCustomer(customer, `Your WearShare order ${order.id}: ${status.replace("_", " ")}`, lines([text, ``, `Order reference: ${order.id}`, `Item: ${itemName}`]));
}

function customerPayment({ order, itemName, customer, paid }) {
  if (!paid) return lastSend; // a correction on our side; no need to alarm anyone
  return sendToCustomer(
    customer,
    `Payment received for order ${order.id}`,
    lines([`We've received your payment of ${rs(order.price_total)}. Thank you.`, ``, `Order reference: ${order.id}`, `Item: ${itemName}`])
  );
}

function customerShipment({ order, itemName, customer, direction, courier, trackingNumber }) {
  const outbound = direction === "outbound";
  return sendToCustomer(
    customer,
    `Your WearShare order ${order.id}: ${outbound ? "shipping details" : "return pickup booked"}`,
    lines([
      outbound ? `Your order has been handed to the courier.` : `Your return has been booked with the courier.`,
      ``,
      `Courier: ${courier}`,
      `Tracking number: ${trackingNumber}`,
      `Order reference: ${order.id}`,
      `Item: ${itemName}`,
    ])
  );
}

function customerCancelled({ order, itemName, customer, by, refundDue }) {
  return sendToCustomer(
    customer,
    `Your WearShare order ${order.id} is cancelled`,
    lines([
      by === "customer" ? `As you asked, we've cancelled your order.` : `Your order has been cancelled by us. If you didn't expect this, just reply to this email.`,
      ``,
      `Order reference: ${order.id}`,
      `Item: ${itemName}`,
      refundDue ? `\nYou had already paid, so we'll refund ${rs(order.price_total)}. We'll email you as soon as it's sent.` : null,
    ])
  );
}

function customerRefundSent({ order, itemName, customer }) {
  return sendToCustomer(
    customer,
    `Refund sent for order ${order.id}`,
    lines([`We've sent your refund of ${rs(order.price_total)}.`, `Depending on your bank or wallet it can take a day or two to show up.`, ``, `Order reference: ${order.id}`, `Item: ${itemName}`])
  );
}

function customerReturned({ order, itemName, customer, lateFee, damageFee, daysLate }) {
  const total = lateFee + damageFee;
  return sendToCustomer(
    customer,
    `We've received your rental back: order ${order.id}`,
    lines([
      `Thank you, we've received ${itemName} back.`,
      ``,
      daysLate > 0 && lateFee > 0 ? `Late fee: ${rs(lateFee)} (${daysLate} day${daysLate === 1 ? "" : "s"} late)` : null,
      damageFee > 0 ? `Damage charge: ${rs(damageFee)}` : null,
      total > 0 ? `Total to pay: ${rs(total)}. We'll be in touch about how to settle it.` : `Nothing further to pay.`,
      ``,
      `Order reference: ${order.id}`,
    ])
  );
}

function customerDueBack({ order, itemName, customer, lateFeePerDay }) {
  return sendToCustomer(
    customer,
    `Your rental is due back today: order ${order.id}`,
    lines([
      `A friendly reminder: ${itemName} is due back today.`,
      `Please have it ready for the courier. After today a late fee of ${rs(lateFeePerDay)} per day applies.`,
      ``,
      `Order reference: ${order.id}`,
    ])
  );
}

function customerLate({ order, itemName, customer, daysLate, feeSoFar }) {
  return sendToCustomer(
    customer,
    `Your rental is overdue: order ${order.id}`,
    lines([
      `${itemName} was due back on ${order.rent_end_date} and is now ${daysLate} day${daysLate === 1 ? "" : "s"} late.`,
      `The late fee so far is ${rs(feeSoFar)}, and it grows each day until we receive it. Please get it back to us as soon as you can.`,
      ``,
      `Order reference: ${order.id}`,
    ])
  );
}

function notifyOrderCancelledByCustomer({ orderId, itemName, refundDue, amount, method }) {
  return sendMail(
    `[WearShare] Customer cancelled order ${orderId}`,
    lines([`The customer cancelled order ${orderId} (${itemName}). The piece is available again.`, refundDue ? `They had paid (${method === "cod" ? "cash on delivery" : "online"}): REFUND DUE ${rs(amount)}.` : `Nothing had been paid, so no refund is needed.`])
  );
}

function notifyReturned({ orderId, itemName, daysLate, lateFee, damageFee, condition }) {
  return sendMail(
    `[WearShare] Rental ${orderId} returned`,
    lines([`${itemName} (order ${orderId}) was recorded as returned.`, condition ? `Condition: ${condition}` : null, daysLate > 0 ? `${daysLate} day(s) late, late fee ${rs(lateFee)}` : null, damageFee > 0 ? `Damage charge ${rs(damageFee)}` : null, lateFee + damageFee > 0 ? `Charges due: ${rs(lateFee + damageFee)}` : null])
  );
}

function notifyPayoutOwed({ payoutId, providerName, itemName, amount, orderId }) {
  return sendMail(
    `[WearShare] Payout owed: ${rs(amount)} to ${providerName}`,
    lines([`A provider payout is now owed.`, `Provider: ${providerName}`, `Item: ${itemName}   Order: ${orderId}`, `Amount: ${rs(amount)}`, `Pay them, then mark it paid in the admin Payouts screen.`])
  );
}

function notifyOverdue({ orderId, itemName, daysLate, feeSoFar }) {
  return sendMail(
    `[WearShare] Rental ${orderId} is overdue`,
    lines([`${itemName} (order ${orderId}) is ${daysLate} day(s) overdue. Late fee so far: ${rs(feeSoFar)}.`, `The customer has been sent a reminder.`])
  );
}

// Resolves once every message queued so far has been attempted (used by tests).
const flush = () => chain.catch(() => {});

module.exports = { sendToProvider, providerIntakeReceived, providerItemListed, providerItemBooked, providerPayoutPaid, sendMail, flush, notifyPayoutOwed, customerCancelled, customerRefundSent, customerReturned, customerDueBack, customerLate, notifyOrderCancelledByCustomer, notifyReturned, notifyOverdue, customerOrderPlaced, customerStatus, customerPayment, customerShipment, notifyNewOrder, notifyNewIntake, notifyOrderStatus, notifyPayment, notifyShipment, notifyItemStatus, notifyPayoutPaid };