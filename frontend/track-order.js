/* ------------------------------------------------------------
   Order tracking lookup
   ------------------------------------------------------------
   Matches against the mock TRACK_ORDERS array in data.js. Once
   the backend exists, replace the lookup with a real call to
   GET /orders/:id?email=... (see the API specification document).
--------------------------------------------------------------- */

function trackStatusLabel(status) {
  return status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("track-form");
  if (!form) return;

  const idInput = document.getElementById("track-id");
  const emailInput = document.getElementById("track-email");
  const resultEl = document.getElementById("track-result");

  [idInput, emailInput].forEach((input) => {
    input.addEventListener("input", () => {
      input.classList.remove("field-error");
    });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    let valid = true;
    const idVal = idInput.value.trim();
    const emailVal = emailInput.value.trim();

    if (!idVal) {
      idInput.classList.add("field-error");
      document.getElementById("err-track-id").classList.add("show");
      valid = false;
    } else {
      document.getElementById("err-track-id").classList.remove("show");
    }

    if (!emailVal) {
      emailInput.classList.add("field-error");
      document.getElementById("err-track-email").classList.add("show");
      valid = false;
    } else {
      document.getElementById("err-track-email").classList.remove("show");
    }

    if (!valid) return;

    const order = TRACK_ORDERS.find(
      (o) => o.id.toLowerCase() === idVal.toLowerCase() && o.email.toLowerCase() === emailVal.toLowerCase()
    );

    if (!order) {
      resultEl.innerHTML = `
        <div class="track-not-found">
          We couldn't find an order matching that reference and email. Double-check both, or
          try the sample reference above.
        </div>`;
      return;
    }

    const rows = [];
    rows.push(`<div class="spec-row"><span class="k">Order</span><span class="v">${order.id}</span></div>`);
    rows.push(`<div class="spec-row"><span class="k">Type</span><span class="v">${order.type === "rent" ? "Rent" : "Buy"}</span></div>`);
    if (order.type === "rent" && order.rentEnd) {
      rows.push(`<div class="spec-row"><span class="k">Return by</span><span class="v">${order.rentEnd}</span></div>`);
    }
    if (order.trackingNumber) {
      rows.push(`<div class="spec-row"><span class="k">Carrier</span><span class="v">${order.carrier}</span></div>`);
      rows.push(`<div class="spec-row"><span class="k">Tracking #</span><span class="v">${order.trackingNumber}</span></div>`);
    }

    resultEl.innerHTML = `
      <div class="track-result tag">
        <div class="item-name-line">${order.item}</div>
        <span class="status-pill ${order.status}">${trackStatusLabel(order.status)}</span>
        <div class="spec-sheet">${rows.join("")}</div>
      </div>`;
  });
});