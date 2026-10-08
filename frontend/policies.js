/* ------------------------------------------------------------
   Policies page: the rules are written in policies.html; this only
   fills in the two things that come from the shop's settings (the
   late-fee rule and the contact details), so they can never disagree
   with what the site actually does.
--------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const info = await loadSiteInfo();
  if (!info) return;
  const fee = document.getElementById("late-fee-text");
  if (fee) fee.textContent = lateFeeText(info);
  const box = document.getElementById("policy-contact");
  if (box) box.innerHTML = `Write to us and we'll get back to you: ${contactHtml(info)}.`;
});