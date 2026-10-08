# Putting WearShare online with Render

Two stages, in this order:

1. **A private preview for your client** (free). Protected by a password, filled with demo items, safe to click around in.
2. **The real, live site** (paid). Clean database, your own domain, emails working, data kept safe on a disk.

Why not Vercel? Vercel runs your code in short-lived functions with no disk that lasts and no server that stays on. WearShare keeps its data in a file, remembers admin sign-ins in memory and runs timers (reminder emails, daily backups), so it needs an always-on server with a disk. Render gives you exactly that.

---

## Part 0: put the code on GitHub (once)

Render deploys from a GitHub repository.

1. Install **GitHub Desktop** (desktop.github.com) and sign in with your GitHub account.
2. In GitHub Desktop: **File > Add local repository**, pick the `wear-share` folder. If it says it isn't a repository, click "create a repository" in that message.
3. Before committing, look at the list of changed files. **`.env` and `data.sqlite` must NOT be in the list.** (The `.gitignore` file keeps them out. If you see them, stop and tell me.)
4. Write a summary such as "First version", click **Commit to main**, then **Publish repository**. **Tick "Keep this code private".**

Later changes: copy the new files into the folder, commit and push in GitHub Desktop. Render redeploys by itself.

---

## Part 1: the private client preview (free)

1. Sign in at render.com (you already use GitHub). Click **New > Blueprint**.
2. Connect your GitHub account if asked, and pick the `wear-share` repository. Render reads `render.yaml` and shows one service, `wearshare-preview`.
3. It asks for three values:
   - `SITE_PASSWORD`: the password your client will type to see the site. Make one up and send it to them separately from the link.
   - `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your admin login for the preview (at least 10 characters).
4. Click **Apply**. The first build takes a few minutes. When it says **Live**, open the address at the top (it looks like `https://wearshare-preview-xxxx.onrender.com`).
5. Your browser asks for a username and password. Type anything as the username and your `SITE_PASSWORD` as the password. You should see the shop with the demo items.

**Check the visitor-address setting (one minute, important).** The site limits repeated login attempts per visitor, so it must know who the visitor really is.
1. Go to `/admin`, sign in, then open `/api/admin/client-ip` on the same address.
2. `seen_as` should be **your own public IP address** (search "what is my IP" to compare), not something starting with `10.` or `172.`.
3. If it isn't, open the service in Render > **Environment**, change `TRUST_PROXY_HOPS` from `1` to `2`, save, and check again.

**What your client should know**
- The first visit after 15 quiet minutes takes about a minute to wake up.
- The preview forgets everything whenever it sleeps or restarts, so orders and items added during the review disappear and the demo data returns. That's normal.
- It can't send emails (the free plan blocks them), so nobody receives order emails during the review.
- Customers' payment is not real. Online and card payments aren't connected.

Send me the client's feedback as one list and I'll work through it. After each round, push the new files and Render updates the preview.

---

## Part 2: going live (paid)

### Before you start
- [ ] The client has signed off.
- [ ] You've read `policies.html` and edited anything that isn't how you run things.
- [ ] You have a domain name (optional but recommended, for example from Namecheap or a .pk registrar), and the Gmail app password for the shop's email address.

### Steps
1. In Render: **New > Blueprint**, pick the same repository, and change **Blueprint file path** to `render.live.yaml`. Render shows the `wearshare` service on a paid plan with a 1 GB disk. (A disk is what keeps your orders and photos between restarts. Prices are on render.com/pricing: the web service and the disk are billed separately.)
2. Fill in the values it asks for:

   | Setting | What to put |
   | --- | --- |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Your real admin login. 10+ characters, not the demo one. |
   | `SMTP_USER`, `SMTP_PASS` | The shop's Gmail address and its app password. |
   | `PUBLIC_URL` | Your final address, for example `https://www.yourshop.pk` (no slash at the end). |
   | `CONTACT_EMAIL`, `CONTACT_WHATSAPP` | How customers reach you. |
   | `ONLINE_PAYMENT_INSTRUCTIONS` | Your bank / wallet details. Use `\n` for line breaks. |

   Optional extras: add `DELIVERY_FEE`, `FREE_DELIVERY_OVER`, `LATE_FEE_PER_DAY` and `PROVIDER_SHARE_PERCENT` in Render's Environment tab (see `.env.example`).
3. Click **Apply** and wait for **Live**. The shop starts **empty** (no demo data), which is what you want.
4. **Your domain:** in the service's **Settings > Custom Domains**, add your domain. Render shows the DNS records to create at your registrar. HTTPS is set up automatically. This can take from minutes to a few hours.
5. Redo the **visitor-address check** from Part 1, using your real domain.
6. **Dry run:** sign in at `/admin`, add one real piece, place a cash-on-delivery order with your own email, and check that you receive the order emails. Then cancel the order.
7. Add your real pieces (through the intake form and the admin Listings screen).
8. Delete or suspend the preview service so it doesn't confuse anyone.

### Keeping it safe
- On the admin **Dashboard**, **download a backup** once a week and keep it somewhere that isn't Render (your computer, cloud storage). The server also saves daily copies on the disk, but a copy next to the data doesn't help if the disk itself is lost.
- Restoring: the backup is a copy of the database file. Contact me and I'll walk you through putting it back on the disk.
- Updating the site briefly takes it offline (a minute or so) while the new version starts, because a service with a disk can't switch over without a gap. Deploy at quiet times.
- Never put your passwords in files that go to GitHub. They belong in Render's Environment tab only.

### If something goes wrong
- **Build failed:** open the service's **Logs**; send me the last 30 lines.
- **"This page isn't connected to the WearShare backend":** the service is asleep (preview only) or crashed. Wait a minute, then check **Logs**.
- **Nobody can sign in to admin:** the log says "no admin account". Check that `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, with a password of 10+ characters.
- **Emails don't arrive:** check the log for `[email] FAILED`. On the free plan emails are blocked; on the live plan check `SMTP_USER` and the app password.
- **Everyone gets "too many attempts":** `TRUST_PROXY_HOPS` is wrong. Redo the visitor-address check.