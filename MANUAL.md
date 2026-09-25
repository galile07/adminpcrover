# PCROVER Admin — User Manual

A step-by-step guide to everything the admin system can do: logging in, the dashboard, online orders, POS, inventory, Lazada syncing, price automation, and offline mode.

The admin panel lives at:

- **https://galile07.github.io/adminpcrover** (or the custom domain **https://admin.pcroverph.shop**)

This is a browser-based website. There is nothing to install. It works best on a desktop or laptop browser. Use a recent version of Chrome, Edge, or Firefox.

---

## 1. Logging In

1. Open `https://admin.pcroverph.shop` in your browser.
2. Enter your login details:
   - **Username:** `admin`
   - **Password:** `pcrover123`
3. Click **Log In**.

You will land on the **Dashboard**.

Useful things on every page:
- **Dark/Light mode:** the button labeled `Dark` (or `Light`) in the top-right corner switches the color theme.
- **Log out:** the **Log out** button in the top-right corner returns you to the login screen. There is no sign-in timeout — you stay logged in as long as you stay in the app, but it is good practice to log out when done.
- **Navigation:** the left sidebar takes you between pages. Pages are:

| Page | Purpose |
|---|---|
| Dashboard | At-a-glance sales and order overview |
| POS System | Ring up walk-in customers and accept cash |
| Online Orders | Manage orders placed through the customer website |
| Inventory | Your product catalog and stock levels |
| Price Automation | Automatic price adjustments based on stock |
| Sync Settings | Connect and sync your Lazada seller account |

**Notification dots:** a **red dot** appears next to **Online Orders** when there are orders waiting to be accepted, and next to **Inventory** when products are running low. Dots update automatically while you are on the site.

---

## 2. The Dashboard

The dashboard is the home screen. It opens with a **Quick overview** section.

### Stat cards
- **Recent orders** — total orders, both walk-in and online.
- **Orders to accept** — online orders still waiting for your confirmation.
- **Daily sales** — sales captured today (₱).
- **Monthly sales** — sales captured this month (₱).
- **Low-stock items** — products sitting at or below their low-stock threshold.

The **Review orders** button jumps straight to the Online Orders page.

### Charts
- **Sales trend** — daily sales for the last 7 days.
- **Sales by channel** — this month's online vs. walk-in sales.
- **Order status** — breakdown of all recorded orders by status.
- **Low-stock watch** — products that are low or out of stock (shows a message when everything is well stocked).

### Recent orders table
Lists recent orders with **Date, Order Code, Customer, Status, and Price**. Click into **Online Orders** to work with them.

---

## 3. Online Orders

The Online Orders page is where you handle every order placed on the customer website. The page is organized into tabs:

| Tab | Shows orders with status |
|---|---|
| **To Accept** | `pending` — new orders waiting for your confirmation |
| **To Deliver** | `shipped` — confirmed and shipped, awaiting delivery |
| **To Finish** | `delivered` — delivered to the customer |
| **Finished** | `completed` — finished orders |
| **Cancelled** | `cancelled` — orders you or the customer cancelled |

Each order card shows the order code, customer, items, price, and status. Click an order to open the **Order Information** window with full details.

### What you can do depending on the status

- **To Accept (pending):**
  - **Accept** — confirms the order. This is the first thing to do when a new order comes in. Accepting normally reserves the stock / continues the flow.
  - **Decline** — rejects the order. The order is cancelled and moved to the **Cancelled** tab. You will be asked for a reason.
- **Paid orders that can be cancelled:** pick **Cancel**. A dialog appears with a **Reason for cancellation** dropdown:
  - Inventory issue
  - Price issue
  - Operational overload
  - Click **Confirm Cancellation** to finalize.
- **To Deliver (shipped):** mark the order as **Delivered** once the customer receives it. It moves to **To Finish**.
- **To Finish (delivered):** finish the order once the sale is fully closed. It moves to **Finished**.

> The customer is only told that their order was confirmed, delivered, finished, or cancelled. The cancellation **reason** you pick is saved on the admin side and is visible to the shop owner in this panel.

### Searching cancelled orders
When the **Cancelled** tab is selected, a search box appears at the top — type part of an order code to find a specific cancelled order.

### How cancellations are recorded
A cancellation is recorded with the status `cancelled`, who cancelled it (the customer or the store/admin), and your chosen reason. This history is stored in the database and appears here under **Cancelled**.

---

## 4. POS System (Point of Sale)

Use the POS to make in-store sales with cash payment. It uses your **Inventory** and **Imported** products — anything with stock > 0 and enabled shows up here.

### Making a sale
1. **(Optional)** Type in the **search box** to filter products, or click a **category** button (Computers, Accessories, Security, Preowned, Other) to narrow the grid.
2. Click a product card to add one unit to **Current Order**. The price shown on each card is the live selling price — including any price-automation adjustment (see section 7).
3. Adjust quantities with the **+ / −** buttons next to each cart line. The POS will not let you sell more than the available stock.
4. Check the **Subtotal** and **Total**.
5. Click **Pay Now ₱…**.
6. In the **Cash Payment** window, enter the **Amount Received** in ₱. The **Change** is computed automatically.
7. Click **Complete Payment**.

The sale is immediately recorded:
- It's saved as a **walk-in order** (`pos_orders`) and appears in the dashboard's sales totals.
- Product **stock is reduced** in both the named inventory and any imported (Lazada) product with the same name.
- A green toast confirms the transaction and shows the change to give.

### Offline mode (POS works with no internet)
The POS is **offline-first**:
- The app is cached in the browser by a service worker, so the POS page opens even with no connection (as long as you've visited the site online at least once).
- Product data is also cached, so the product grid still shows prices, categories, and stock.
- While offline, an orange banner appears at the bottom: **"Offline mode — POS keeps working…"**
- Sales you finish while offline are queued safely in the browser.

**Auto sync:** the moment your connection returns, the queued sales are pushed to the server automatically (also checked every 30 seconds). A blue **"Syncing… N order(s) remaining"** banner shows progress, followed by a toast: **"Offline orders synced to the dashboard."** Stock sold offline is then synchronized too.

> Best practice: keep the POS page open while offline; when the internet returns, wait for the "synced" confirmation before closing the browser, so queued sales don't get lost.

---

## 5. Inventory

The Inventory page manages your full product catalog.

### The three tabs
| Tab | What it shows |
|---|---|
| **All Products** | Inventory products and imported (Lazada) products combined |
| **Inventory** | Your manually-managed products (stock, price, images) |
| **Imported** | Products pulled in from your Lazada listing |

### Searching and browsing
- Use the **search box** to filter by product name or category.
- The table pages automatically (10 products per page) with **Prev / Next** buttons and page numbers.
- The list sorts **low-stock items first**, so empty shelves appear at the top.
- Each row shows **Image, Product, Category, Price, Stock, Status, Action**.

### Adding a product (Inventory tab)
1. Click **+ Add Product**.
2. Fill in:
   - **Product Name** (required)
   - **Description** — shown on the customer's product page
   - **Price** (₱)
   - **Stock** (number of units on hand)
   - **Low Stock Threshold** — the number at which the product gets flagged low/out of stock
   - **Product Image** — attach a picture (optional)
3. Click **Save Product**.

### Editing / deleting a product
1. Click the edit action on the row.
2. Edit any field and click **Save Product**.
3. To remove the product completely, click the red **Delete** button inside the edit window.

### Imported (Lazada) products
Products imported from Lazada can also be edited — click their edit action to change the **name, description, price, or stock** (the modal is labeled "Edit Imported Product"). This is your local copy; the next Lazada sync may overwrite or re-import fields.

---

## 6. Lazada Sync (Sync Settings)

The **Sync Settings** page connects the system to your Lazada seller account so online orders and products come into the admin automatically.

### First-time connection
1. Open **Sync Settings**.
2. Click **Connect Lazada**. A Lazada authorization window opens in a new browser tab.
3. Log in to Lazada and **authorize** the connection.
4. You'll be returned to the site, which shows a green banner: **"Lazada connected successfully!"**

When connected, the status pill reads **Connected** and shows when the account was linked.

### Syncing
- Click **Sync Lazada** to manually pull orders and products from Lazada into the system.
- A check cue appears: **"Lazada synced to this system — last sync …"** with the timestamp.

### Reconnecting / expired connection
Lazada connections **expire**. When they do, the status pill turns yellow and reads **Reconnect needed**. The **Connect** button changes to **Reconnect**.
1. Click **Reconnect**.
2. Authorize again in the Lazada window that opens.
3. Resume syncing.

This step cannot be automated — you must click **Reconnect** and approve the connection yourself.

---

## 7. Price Automation

Price Automation lets you set **rules** that automatically adjust a product's selling price based on its **stock level**. Prices in the POS update immediately when a rule applies.

### How rules work
A rule is made of two parts:

**1. Trigger (when it fires):**
- **Stock** — rule checks the product's current stock.
- **Sales** — (option listed for future use; only **Stock** triggers are evaluated today).
- Operator: **Greater than**, **Less than**, **Equal to** — plus a number value.

Example trigger: *Stock is Less than 10* → fires for every product with fewer than 10 units on hand.

**2. Action (what it does to the price):**
- **Direction:** `+` (increase) or `−` (decrease).
- **Amount:** a number.
- **Type:** **%** (percentage of the current price) or **Fixed ₱** (flat amount).

Example action: *Decrease by 5%* → a ₱1,000 product becomes ₱950.

Rules **stack** — if several enabled rules match the same product, they are applied one after another.

### Creating a rule
1. Open **Price Automation**.
2. Click **+ Add Rule**.
3. Set the **Trigger Condition** (field, operator, value).
4. Set the **Price Adjustment** (direction, amount, type).
5. Click **Save Rule**.

### Managing rules
The rules table shows: **#**, **Rule Name**, **Trigger**, **Action**, **Status**, and **Action**.
- The toggle button enables / disables a rule (disabled rules are ignored).
- The edit button opens the same window pre-filled so you can change the rule.
- The delete button removes the rule.

### Seeing it in action
On the POS, any product affected by an active rule is marked with a **"rule"** tag next to its price. Hover for the tooltip **"Price automation active"**. The displayed price is the final selling price after rules.

> Rules only affect the **selling price shown in the POS/in cart**; they don't rewrite your base price in inventory. Turn a rule off or change its value to stop affecting pricing.

---

## 8. Quick Troubleshooting & Tips

| Problem | Solution |
|---|---|
| Site looks outdated / changes not showing | Hard refresh: press **Ctrl + Shift + R** (PC) or **Cmd + Shift + R** (Mac) |
| Wrong prices on POS | Check **Price Automation** — an active rule may be adjusting the price (look for the "rule" tag) |
| Red dot on Online Orders won't go away | Accept the pending orders in the **To Accept** tab |
| Order won't cancel | Pick a reason in the dialog — cancellations require a reason to be saved |
| "Reconnect needed" pill in Sync Settings | Click **Reconnect** on the **Sync Settings** page and re-authorize Lazada |
| POS has nothing in the grid | Products must be **enabled** and have **stock > 0** on the Inventory page |
| Offline banner appears | You're offline; POS still works. Sales will sync automatically when the connection returns |

### Before relying on offline mode
- Visit the site once while online so the browser caches the pages (the service worker pre-caches everything).
- When working offline, wait for the "synced" confirmation after the internet returns before closing the tab.

---

That covers the full workflow: log in, watch the dashboard, accept and manage online orders, ring up walk-in sales at the POS (even offline), keep your catalog and stock healthy, sync Lazada, and let stock-based rules manage your pricing automatically.