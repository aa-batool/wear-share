/* ------------------------------------------------------------
   Intake form logic
   ------------------------------------------------------------
   No backend yet — a valid submit swaps the form for a mock
   confirmation with a generated reference number. Once the
   backend exists, replace handleSubmit() with a real
   POST /admin/providers + POST /admin/providers/:id/items call
   (see the API specification document).
--------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("intake-form");
  if (!form) return;

  const handoffRadios = form.querySelectorAll('input[name="handoff"]');
  const addressField = document.getElementById("address-field");
  const addressInput = document.getElementById("address");

  function syncAddressField() {
    const isPickup = form.querySelector('input[name="handoff"]:checked').value === "pickup";
    addressField.classList.toggle("visible", isPickup);
    if (!isPickup) clearError(addressInput, "err-address");
  }
  handoffRadios.forEach((r) => r.addEventListener("change", syncAddressField));
  syncAddressField();

  const fields = [
    { input: document.getElementById("item-name"), errorId: "err-item-name", required: true },
    { input: document.getElementById("category"), errorId: "err-category", required: true },
    { input: document.getElementById("size"), errorId: "err-size", required: true },
    { input: document.getElementById("condition"), errorId: "err-condition", required: true },
    { input: document.getElementById("contact-name"), errorId: "err-contact-name", required: true },
    { input: document.getElementById("contact-email"), errorId: "err-contact-email", required: true, isEmail: true },
    { input: document.getElementById("contact-phone"), errorId: "err-contact-phone", required: true },
  ];

  fields.forEach(({ input, errorId }) => {
    input.addEventListener("input", () => clearError(input, errorId));
    input.addEventListener("change", () => clearError(input, errorId));
  });
  addressInput.addEventListener("input", () => clearError(addressInput, "err-address"));

  function showError(input, errorId) {
    input.classList.add("field-error");
    document.getElementById(errorId).classList.add("show");
  }
  function clearError(input, errorId) {
    input.classList.remove("field-error");
    document.getElementById(errorId).classList.remove("show");
  }
  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validate() {
    let valid = true;
    fields.forEach(({ input, errorId, required, isEmail }) => {
      const value = input.value.trim();
      if (required && !value) {
        showError(input, errorId);
        valid = false;
      } else if (isEmail && value && !isValidEmail(value)) {
        showError(input, errorId);
        valid = false;
      } else {
        clearError(input, errorId);
      }
    });

    const isPickup = form.querySelector('input[name="handoff"]:checked').value === "pickup";
    if (isPickup && !addressInput.value.trim()) {
      showError(addressInput, "err-address");
      valid = false;
    }
    return valid;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validate()) {
      const firstError = form.querySelector(".field-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    handleSubmit();
  });

  function handleSubmit() {
    const outcome = form.querySelector('input[name="outcome"]:checked').value;
    const handoff = form.querySelector('input[name="handoff"]:checked').value;
    const outcomeLabel = { rent: "Rent it out", sell: "Sell it", either: "Either — you decide" }[outcome];
    const handoffLabel = handoff === "pickup" ? "Pickup" : "Drop-off";
    const reference = "WS-" + Math.floor(100000 + Math.random() * 900000);

    const itemName = document.getElementById("item-name").value.trim();
    const category = document.getElementById("category").value;
    const size = document.getElementById("size").value.trim();
    const condition = document.getElementById("condition").value;

    document.getElementById("form-wrap").innerHTML = `
      <div class="confirmation tag">
        <h2>Got it — thanks.</h2>
        <p>Your reference number is <span class="ref">${reference}</span>. This is a prototype,
        so nothing was actually sent anywhere, but here's what a real submission would carry:</p>
        <div class="spec-sheet">
          <div class="spec-row"><span class="k">Item</span><span class="v">${itemName}</span></div>
          <div class="spec-row"><span class="k">Category</span><span class="v">${category}</span></div>
          <div class="spec-row"><span class="k">Size</span><span class="v">${size}</span></div>
          <div class="spec-row"><span class="k">Condition</span><span class="v">${condition}</span></div>
          <div class="spec-row"><span class="k">Preference</span><span class="v">${outcomeLabel}</span></div>
          <div class="spec-row"><span class="k">Handoff</span><span class="v">${handoffLabel}</span></div>
        </div>
        <p>In the real flow, we'd follow up by email or phone within a couple of business days
        to confirm pickup or drop-off details.</p>
        <a class="cta" href="index.html">Back to browsing</a>
      </div>
    `;
  }
});