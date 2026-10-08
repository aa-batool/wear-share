/* ------------------------------------------------------------
   Intake form logic
   ------------------------------------------------------------
   Validates in the browser for quick feedback, then submits to
   POST /api/intake. The server validates again (never trust the
   browser alone), and the item lands in the admin panel's intake
   queue — it does not appear in the public catalog until an admin
   photographs, prices, and publishes it.
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

  async function handleSubmit() {
    const outcome = form.querySelector('input[name="outcome"]:checked').value;
    const handoff = form.querySelector('input[name="handoff"]:checked').value;
    const value = document.getElementById("value").value;

    const payload = {
      item: {
        name: document.getElementById("item-name").value.trim(),
        category: document.getElementById("category").value,
        size: document.getElementById("size").value.trim(),
        condition: document.getElementById("condition").value,
        brand: document.getElementById("brand").value.trim(),
        notes: document.getElementById("notes").value.trim(),
      },
      outcome,
      estimated_value: value ? Number(value) : null,
      payout_details: document.getElementById("payout-details").value.trim(),
      contact: {
        name: document.getElementById("contact-name").value.trim(),
        email: document.getElementById("contact-email").value.trim(),
        phone: document.getElementById("contact-phone").value.trim(),
      },
      handoff,
      address: handoff === "pickup" ? addressInput.value.trim() : null,
      preferred_date: document.getElementById("pickup-date").value || null,
    };

    const submitBtn = document.getElementById("submit-btn");
    let errorBox = document.getElementById("submit-error");
    if (!errorBox) {
      errorBox = document.createElement("div");
      errorBox.id = "submit-error";
      errorBox.className = "conflict-warning";
      submitBtn.parentNode.insertBefore(errorBox, submitBtn);
    }
    errorBox.classList.remove("show");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      const result = await api("/api/intake", { method: "POST", body: payload });
      showConfirmation(result.reference, payload, outcome, handoff);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.add("show");
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit item";
    }
  }

  function showConfirmation(reference, payload, outcome, handoff) {
    const outcomeLabel = { rent: "Rent it out", sell: "Sell it", either: "Either — you decide" }[outcome];
    const handoffLabel = handoff === "pickup" ? "Pickup" : "Drop-off";

    document.getElementById("form-wrap").innerHTML = `
      <div class="confirmation tag">
        <h2>Got it — thanks.</h2>
        <p>Your reference number is <span class="ref">${esc(reference)}</span>. We've logged the item and it's
        in our queue to be photographed and listed. Here's what we have:</p>
        <div class="spec-sheet">
          <div class="spec-row"><span class="k">Item</span><span class="v">${esc(payload.item.name)}</span></div>
          <div class="spec-row"><span class="k">Category</span><span class="v">${esc(payload.item.category)}</span></div>
          <div class="spec-row"><span class="k">Size</span><span class="v">${esc(payload.item.size)}</span></div>
          <div class="spec-row"><span class="k">Condition</span><span class="v">${esc(payload.item.condition)}</span></div>
          <div class="spec-row"><span class="k">Preference</span><span class="v">${esc(outcomeLabel)}</span></div>
          <div class="spec-row"><span class="k">Handoff</span><span class="v">${esc(handoffLabel)}</span></div>
        </div>
        <p>We'll reach out to confirm ${handoff === "pickup" ? "a pickup time" : "drop-off details"}.</p>
        <p class="hint">Keep your reference (${esc(reference)}) if you need to ask us about this piece. We'll email you as it moves along.</p>
        <a class="cta" href="index.html">Back to browsing</a>
      </div>
    `;
  }
});