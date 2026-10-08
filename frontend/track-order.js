/* ------------------------------------------------------------
   Order tracking lookup
   ------------------------------------------------------------
   Calls GET /api/orders/:id?email=... — the server deliberately
   answers the same way whether the order doesn't exist or the
   email just doesn't match, so this page can't be used to probe
   for valid order references.
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("track-form");
  if (!form) return;

  const idInput = document.getElementById("track-id");
  const emailInput = document.getElementById("track-email");
  const resultEl = document.getElementById("track-result");
  const submitBtn = form.querySelector("button[type=submit]");

  // The checkout confirmation links here with ?ref=... so the shopper
  // only has to type their email.
  const presetRef = new URLSearchParams(location.search).get("ref");
  if (presetRef) {
    idInput.value = presetRef;
    emailInput.focus();
  }

  [idInput, emailInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("field-error");
      document.getElementById(input === idInput ? "err-track-id" : "err-track-email").classList.remove("show");
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const idVal = idInput.value.trim();
    const emailVal = emailInput.value.trim();
    let valid = true;

    [[idInput, idVal, "err-track-id"], [emailInput, emailVal, "err-track-email"]].forEach(([input, value, errId]) => {
      input.classList.toggle("field-error", !value);
      document.getElementById(errId).classList.toggle("show", !value);
      if (!value) valid = false;
    });
    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    resultEl.innerHTML = "";

    try {
      const order = await api(`/api/orders/${encodeURIComponent(idVal)}?email=${encodeURIComponent(emailVal)}`);
      showOrder(order, emailVal);
    } catch (err) {
      const message =
        err.code === "order_not_found"
          ? "We couldn't find an order matching that reference and email. Double-check both and try again."
          : err.message;
      resultEl.innerHTML = `<div class="track-not-found">${esc(message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Check status";
    }
  });

  function showOrder(order, email, notice) {
    resultEl.innerHTML = (notice ? `<div class="track-notice">${esc(notice)}</div>` : "") + renderResult(order);

    // Anyone looking at an order can see how to reach the shop about it.
    const card = resultEl.querySelector(".track-result");
    loadSiteInfo().then((info) => {
      if (!info || !card || !card.isConnected) return;
      const help = document.createElement("p");
      help.className = "hint track-help";
      help.innerHTML = `${order.cancellable ? "Questions" : "Need to change something, or have a question"} about this order? ${contactHtml(info)}`;
      card.appendChild(help);
    });

    const area = document.getElementById("cancel-area");
    if (!area) return;
    const askButton = () => {
      area.innerHTML = `<button type="button" class="cancel-order-btn" id="cancel-ask">Cancel this order</button>`;
      document.getElementById("cancel-ask").addEventListener("click", confirmStep);
    };
    const confirmStep = () => {
      const paidNote = order.payment_status === "paid" ? " You've already paid, so we'll refund you." : "";
      area.innerHTML = `
        <p class="hint">Cancel this order? This can't be undone.${esc(paidNote)}</p>
        <button type="button" class="cancel-order-btn danger" id="cancel-yes">Yes, cancel my order</button>
        <button type="button" class="cancel-order-btn" id="cancel-no">Keep my order</button>
        <div class="error-text" id="cancel-error"></div>`;
      document.getElementById("cancel-no").addEventListener("click", askButton);
      document.getElementById("cancel-yes").addEventListener("click", async (ev) => {
        ev.target.disabled = true;
        ev.target.textContent = "Cancelling…";
        try {
          await api(`/api/orders/${encodeURIComponent(order.order_id)}/cancel`, { method: "POST", body: { email } });
          const fresh = await api(`/api/orders/${encodeURIComponent(order.order_id)}?email=${encodeURIComponent(email)}`);
          showOrder(fresh, email, "Your order has been cancelled. We've emailed you a confirmation.");
        } catch (err) {
          const box = document.getElementById("cancel-error");
          const info = err.code === "not_cancellable" ? await loadSiteInfo() : null;
          box.innerHTML = esc(err.message) + (info ? ` You can reach us at ${contactHtml(info)}.` : "");
          box.classList.add("show");
          ev.target.disabled = false;
          ev.target.textContent = "Yes, cancel my order";
        }
      });
    };
    askButton();
  }

  function renderResult(order) {
    const rows = [];
    rows.push(`<div class="spec-row"><span class="k">Order</span><span class="v">${esc(order.order_id)}</span></div>`);
    rows.push(`<div class="spec-row"><span class="k">Type</span><span class="v">${order.type === "rent" ? "Rent" : "Buy"}</span></div>`);
    if (order.type === "rent" && order.rent_end_date) {
      rows.push(`<div class="spec-row"><span class="k">Rental ends</span><span class="v">${esc(order.rent_end_date)}</span></div>`);
    }
    if (order.type === "buy" && order.delivery_delayed) {
      rows.push(
        `<div class="spec-row"><span class="k">Delivery</span><span class="v">${
          order.deliver_after ? `After the current rental (not before ${esc(formatDay(order.deliver_after))})` : "After the current rental is returned"
        }</span></div>`
      );
    }
    if (order.status === "cancelled" && order.cancelled_by) {
      rows.push(`<div class="spec-row"><span class="k">Cancelled by</span><span class="v">${order.cancelled_by === "customer" ? "You" : "WearShare"}</span></div>`);
    }
    if (order.refund_status) {
      const text = order.refund_status === "sent" ? `${formatMoney(order.refund_amount)} sent back to you` : `${formatMoney(order.refund_amount)} will be sent back to you`;
      rows.push(`<div class="spec-row"><span class="k">Refund</span><span class="v">${esc(text)}</span></div>`);
    }
    if (order.charges) {
      if (order.charges.late_fee > 0) rows.push(`<div class="spec-row"><span class="k">Late fee</span><span class="v">${esc(formatMoney(order.charges.late_fee))}</span></div>`);
      if (order.charges.damage_fee > 0) rows.push(`<div class="spec-row"><span class="k">Damage charge</span><span class="v">${esc(formatMoney(order.charges.damage_fee))}</span></div>`);
      rows.push(`<div class="spec-row"><span class="k">Extra charges</span><span class="v">${esc(formatMoney(order.charges.total))} — ${order.charges.status === "collected" ? "paid, thank you" : "to be paid"}</span></div>`);
    }
    if (order.delivery_fee > 0) {
      rows.push(`<div class="spec-row"><span class="k">Items</span><span class="v">${esc(formatMoney(order.price_total - order.delivery_fee))}</span></div>`);
      rows.push(`<div class="spec-row"><span class="k">Delivery</span><span class="v">${esc(formatMoney(order.delivery_fee))}</span></div>`);
    }
    if (order.price_total != null) {
      rows.push(`<div class="spec-row"><span class="k">Total</span><span class="v">${esc(formatMoney(order.price_total))}</span></div>`);
    }
    if (order.payment_method) {
      let paymentText;
      if (order.payment_status === "paid") paymentText = `${paymentMethodLabel(order.payment_method)} — paid`;
      else if (order.payment_method === "cod") paymentText = "Cash on delivery — pay the courier when it arrives";
      else paymentText = "Online — waiting for your payment";
      rows.push(`<div class="spec-row"><span class="k">Payment</span><span class="v">${esc(paymentText)}</span></div>`);
    }
    if (order.tracking) {
      rows.push(`<div class="spec-row"><span class="k">Carrier</span><span class="v">${esc(order.tracking.carrier)}</span></div>`);
      rows.push(`<div class="spec-row"><span class="k">Tracking #</span><span class="v">${esc(order.tracking.tracking_number)}</span></div>`);
      rows.push(`<div class="spec-row"><span class="k">Shipment</span><span class="v">${esc(statusLabel(order.tracking.status))}</span></div>`);
    }

    return `
      <div class="track-result tag">
        <div class="item-name-line">${esc(order.item_name)}</div>
        <span class="status-pill ${esc(order.status)}">${esc(statusLabel(order.status))}</span>
        <div class="spec-sheet">${rows.join("")}</div>
        ${
          order.overdue
            ? `<div class="late-banner">This rental is <strong>${order.days_late} day${order.days_late === 1 ? "" : "s"} overdue</strong>. The late fee so far is <strong>${esc(formatMoney(order.late_fee_accruing))}</strong>
               and it grows each day until we receive it. Please get it back to us as soon as you can.</div>`
            : ""
        }
        ${order.cancellable ? `<div class="cancel-area" id="cancel-area"></div>` : ""}
        ${
          order.payment_method === "online" && order.payment_status !== "paid"
            ? order.payment_instructions
              ? `<div class="intake-notes-label">Send your payment to</div>
                 <div class="pay-instructions">${esc(order.payment_instructions)}</div>
                 <p class="hint">Put your order reference (${esc(order.order_id)}) in the payment note.</p>`
              : `<p class="hint">We'll message you the payment details on the email and phone number you gave.</p>`
            : ""
        }
      </div>`;
  }
});