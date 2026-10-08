/* ------------------------------------------------------------
   Payment page (payment.html)
   ------------------------------------------------------------
   The last step of a rental or purchase. The item page's checkout form
   saves the shopper's details as a draft in sessionStorage and sends them
   here; this page shows what they're about to order, lets them choose cash
   on delivery or online payment, and only then places the order with
   POST /api/orders. Nothing is created on the server before that, so
   leaving this page abandons the order without leaving anything behind.

   The server re-checks everything at that moment, so this page also has to
   cope with the world changing while the shopper decides: the dates got
   taken (409 item_unavailable), the piece was bought (409 item_sold), or a
   rental was booked ahead of a purchase (409 delivery_delayed).
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", initPayment);

// The draft comes from sessionStorage, which anything on this origin could
// have written to — so check it has the shape we expect before using it.
function readDraft() {
  const d = loadCheckoutDraft();
  const text = (v) => typeof v === "string" && v.trim() !== "";
  const day = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!d || !text(d.item_id) || (d.type !== "rent" && d.type !== "buy")) return null;
  const c = d.customer;
  if (!c || !text(c.name) || !text(c.email) || !text(c.phone) || !text(c.shipping_address)) return null;
  if (d.type === "rent" && (!day(d.rent_start_date) || !day(d.rent_end_date) || d.rent_end_date < d.rent_start_date)) return null;
  return d;
}

function payMessagePanel(root, heading, bodyHtml) {
  root.innerHTML = `
    <div class="order-confirmation tag pay-done">
      <h2>${heading}</h2>
      ${bodyHtml}
    </div>`;
}

async function initPayment() {
  const root = document.getElementById("pay-root");
  if (!root) return;

  const draft = readDraft();
  const itemParam = new URLSearchParams(location.search).get("item");
  if (!draft || draft.item_id !== itemParam) {
    root.innerHTML = `<div class="empty-state">There's nothing to pay for yet. <a href="index.html">Pick a piece from the closet</a> first.</div>`;
    return;
  }

  root.innerHTML = `<div class="empty-state">Loading…</div>`;
  const site = await loadSiteInfo();
  const loadItem = async () => normalizeItem(await api(`/api/items/${encodeURIComponent(draft.item_id)}`));

  let item;
  try {
    item = await loadItem();
  } catch (err) {
    if (err.code === "item_not_found") return showUnavailable();
    return showLoadError(root, err);
  }

  const isRent = draft.type === "rent";
  const editLink = `item.html?id=${encodeURIComponent(draft.item_id)}&resume=1`;

  function showUnavailable() {
    clearCheckoutDraft();
    payMessagePanel(
      root,
      "This piece is no longer available.",
      `<p>It may have just been bought or taken off the closet. Nothing was ordered.</p>
       <p><a href="index.html" style="color: var(--chambray); text-decoration: underline;">Browse the closet</a></p>`
    );
  }

  function showSold() {
    clearCheckoutDraft();
    payMessagePanel(
      root,
      "Just missed it.",
      `<p>Someone else bought this piece a moment ago, so it's no longer available. Nothing was ordered.</p>
       <p><a href="index.html" style="color: var(--chambray); text-decoration: underline;">Browse the closet</a></p>`
    );
  }

  // opts.method: keep the chosen payment method across a re-render
  // opts.message: an explanation to show above the button (e.g. after a conflict)
  function render(opts = {}) {
    if ((isRent && item.buyOnly) || (!isRent && item.rentOnly)) return showUnavailable();

    const days = isRent ? rentalDays(draft.rent_start_date, draft.rent_end_date) : null;
    const itemsTotal = isRent ? item.rentPerDay * days : item.buyPrice;
    const deliveryFee = deliveryFeeFor(site, itemsTotal);
    const total = itemsTotal + deliveryFee;
    const amount = formatMoney(total);
    const shipsFree = !!(site && site.delivery && site.delivery.fee && deliveryFee === 0);

    // Are the chosen dates still free? (Checked against the item's current bookings.)
    const datesTaken = isRent && item.bookedRanges.some((r) => draft.rent_start_date <= r.end && draft.rent_end_date >= r.start);
    // Buying a piece that's now booked for rental: delivery has to wait, and the
    // buyer has to say they're happy with that before the order can go through.
    const delayed = !isRent && !item.buyAvailability.available;
    const alreadyAgreed = delayed && draft.acknowledge_delayed_delivery === true;

    const summaryRows = [
      ["Item", item.name],
      ["Type", isRent ? "Rental" : "Purchase"],
      isRent ? ["Dates", `${formatDay(draft.rent_start_date)} → ${formatDay(draft.rent_end_date)} (${days} day${days === 1 ? "" : "s"})`] : null,
      ["Name", draft.customer.name],
      ["Deliver to", draft.customer.shipping_address],
    ]
      .filter(Boolean)
      .map(([k, v]) => `<div class="spec-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)
      .join("");

    root.innerHTML = `
      <section class="pay-main">
        <a class="checkout-back" href="${editLink}">&larr; Edit details</a>
        <h1 class="pay-title">How would you like to pay?</h1>
        <p class="pay-sub">Choose a payment method to place your order.</p>

        ${delayed ? `<div class="delivery-notice" id="delivery-notice">${delayedDeliveryNoticeHtml(item.buyAvailability.availableFrom)}</div>` : ""}
        ${
          datesTaken
            ? `<div class="conflict-warning show" id="dates-taken">Someone else booked dates that overlap yours. <a href="${editLink}" style="text-decoration: underline;">Go back and pick different dates.</a></div>`
            : ""
        }

        <form id="pay-form" novalidate>
          <div class="pay-options" role="radiogroup" aria-label="Payment method">
            <label class="pay-option">
              <input type="radio" name="method" value="cod" ${opts.method === "cod" ? "checked" : ""} />
              <span class="pay-option-body">
                <span class="pay-option-title">Cash on delivery</span>
                <span class="pay-option-desc">Pay the courier in cash when your order arrives. Please keep ${esc(amount)} ready.</span>
              </span>
            </label>
            <label class="pay-option">
              <input type="radio" name="method" value="online" ${opts.method === "online" ? "checked" : ""} />
              <span class="pay-option-body">
                <span class="pay-option-title">Pay online</span>
                <span class="pay-option-desc">Bank transfer or mobile wallet. Once you place the order, we'll show you where to send ${esc(amount)}.</span>
              </span>
            </label>
            <label class="pay-option disabled" aria-disabled="true">
              <input type="radio" name="method" value="card" disabled />
              <span class="pay-option-body">
                <span class="pay-option-title">Credit / debit card <span class="pay-soon">Coming soon</span></span>
                <span class="pay-option-desc">Card payments aren't available yet. Please choose cash on delivery or pay online.</span>
              </span>
            </label>
          </div>
          <div class="error-text" id="err-method">Choose how you'd like to pay.</div>

          ${
            delayed
              ? `<div class="form-group">
                   <label class="ack-row"><input type="checkbox" id="pay-ack" ${alreadyAgreed ? "checked" : ""} /> <span>I understand it will be delivered after the rental ends.</span></label>
                   <div class="error-text" id="err-pay-ack">Please confirm you're happy to wait for delivery, or go back.</div>
                 </div>`
              : ""
          }

          <p class="pay-terms" id="pay-terms">${
            isRent ? `Late returns cost ${esc(lateFeeText(site))}. ` : ""
          }You can cancel from the Track your order page until it ships. <a href="policies.html" target="_blank" rel="noopener">Read our policies</a>.</p>
          <div class="conflict-warning ${opts.message ? "show" : ""}" id="pay-error">${esc(opts.message || "")}</div>
          <button type="submit" class="cta" id="pay-submit" ${datesTaken ? "disabled" : ""}>Place order &middot; ${esc(amount)}</button>
        </form>
      </section>

      <aside class="pay-summary tag">
        <div class="pay-summary-title">Your order</div>
        <div class="spec-sheet">${summaryRows}</div>
        ${
          deliveryFee > 0 || shipsFree
            ? `<div class="spec-sheet">
                 <div class="spec-row"><span class="k">${isRent ? "Rental" : "Item"}</span><span class="v">${esc(formatMoney(itemsTotal))}</span></div>
                 <div class="spec-row"><span class="k">Delivery${isRent ? " &amp; collection" : ""}</span><span class="v">${deliveryFee > 0 ? esc(formatMoney(deliveryFee)) : "Free"}</span></div>
               </div>`
            : ""
        }
        <div class="total-row"><span>Total</span><span>${esc(amount)}</span></div>
      </aside>
    `;

    const form = document.getElementById("pay-form");
    const submitBtn = document.getElementById("pay-submit");
    const errorBox = document.getElementById("pay-error");
    const selectedMethod = () => {
      const checked = form.querySelector('input[name="method"]:checked');
      return checked ? checked.value : null;
    };

    form.querySelectorAll('input[name="method"]').forEach((r) =>
      r.addEventListener("change", () => document.getElementById("err-method").classList.remove("show"))
    );
    const ackBox = document.getElementById("pay-ack");
    if (ackBox) ackBox.addEventListener("change", () => document.getElementById("err-pay-ack").classList.remove("show"));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.classList.remove("show");

      const method = selectedMethod();
      let valid = true;
      document.getElementById("err-method").classList.toggle("show", !method);
      if (!method) valid = false;
      if (ackBox) {
        document.getElementById("err-pay-ack").classList.toggle("show", !ackBox.checked);
        if (!ackBox.checked) valid = false;
      }
      if (!valid) return;

      const payload = {
        item_id: draft.item_id,
        type: draft.type,
        payment_method: method,
        customer: draft.customer,
      };
      if (isRent) {
        payload.rent_start_date = draft.rent_start_date;
        payload.rent_end_date = draft.rent_end_date;
      }
      if (ackBox && ackBox.checked) payload.acknowledge_delayed_delivery = true;

      submitBtn.disabled = true;
      submitBtn.textContent = "Placing your order…";

      try {
        const order = await api("/api/orders", { method: "POST", body: payload });
        clearCheckoutDraft();
        renderConfirmation(order);
      } catch (err) {
        if (err.code === "item_sold") return showSold();
        if (err.code === "item_not_found") return showUnavailable();

        if (err.code === "delivery_delayed" || err.code === "item_unavailable") {
          // The piece changed while they were deciding. Re-read it, then redraw so the
          // page explains the new situation (a delay notice, or the dates being taken).
          try {
            item = await loadItem();
            const message =
              err.code === "delivery_delayed"
                ? "This piece was just booked for rental. Please read the note above before you order."
                : "Someone else just booked dates that overlap yours.";
            return render({ method, message });
          } catch (refreshErr) {
            /* fall through to the plain message below */
          }
        }
        errorBox.textContent = err.message;
        errorBox.classList.add("show");
        submitBtn.disabled = false;
        submitBtn.textContent = `Place order · ${amount}`;
      }
    });
  }

  function renderConfirmation(order) {
    const firstName = draft.customer.name.split(" ")[0];
    const amount = formatMoney(order.price_total);
    const trackLink = `track-order.html?ref=${encodeURIComponent(order.order_id)}`;

    let paymentBlock;
    if (order.payment_method === "cod") {
      paymentBlock = `
        <div class="pay-next"><strong>Cash on delivery.</strong> Please pay <strong>${esc(amount)}</strong> in cash to the courier when your order arrives.</div>`;
    } else {
      paymentBlock = `
        <div class="pay-next">
          <strong>Pay online.</strong> Please send <strong>${esc(amount)}</strong> using the details below, and put your order reference
          <span class="ref">${esc(order.order_id)}</span> in the payment note. We'll confirm your order once the payment arrives.
        </div>
        ${
          order.payment_instructions
            ? `<div class="pay-instructions">${esc(order.payment_instructions)}</div>`
            : `<p>We'll message you the payment details on the email and phone number you gave.</p>`
        }`;
    }

    const delivery = order.delivery_delayed
      ? `<p><strong>Delivery:</strong> ${
          order.deliver_after
            ? `it can't leave us before ${esc(formatDay(order.deliver_after))}, once the current rental has finished.`
            : "we'll send it once it's back from its current rental."
        }</p>`
      : "";

    payMessagePanel(
      root,
      `Order placed, ${esc(firstName)}.`,
      `
      <p>Your order reference is <span class="ref">${esc(order.order_id)}</span>. Keep it — you'll need it,
      along with the email you used, to check on your order.</p>
      ${paymentBlock}
      ${delivery}
      <p>You can look it up any time on the
      <a href="${trackLink}" style="color: var(--chambray); text-decoration: underline;">order tracking page</a>.</p>
      <p class="hint">We'll also email you a confirmation and updates as your order moves along.</p>`
    );
  }

  render();
}