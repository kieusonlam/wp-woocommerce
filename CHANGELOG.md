# @kieusonlam/wp-woocommerce

## 0.4.2

### Minor changes

- **HPOS-aware order reads.** New auto-detecting read helpers complement `Order.createOrder` (0.4.1) so the package now supports HPOS for **both** reads and writes:
  - `Order.findOrder(id)` — read one order; uses legacy `wp_posts`/`postmeta` or HPOS `wc_orders*` depending on `woocommerce_custom_orders_table_enabled`.
  - `Order.forCustomer(customerId)` — a customer's orders, newest first (HPOS: filters `wc_orders.customer_id`; legacy: `hasMeta('_customer_user')`).
  - `Order.findOrderHpos(id)` — force an HPOS read (advanced / testing).

  All return a regular `Order` with the usual getters (`total`, `currency`, `billingAddress`, `payment`, …) and `.items()` — HPOS rows are mapped into a postmeta-shaped meta map so every getter works unchanged. The lower-level `Order.query()…` builder is unchanged and still targets legacy postmeta only.

## 0.4.1

### Minor changes

- **`Order.createOrder(input)`** — create a WooCommerce order by writing **directly to the database** (no WC REST API). Inserts the order + line items in a single transaction and **auto-detects HPOS**: reads `woocommerce_custom_orders_table_enabled` / `woocommerce_custom_orders_table_data_sync_enabled` and writes to legacy storage (`wp_posts` + `wp_postmeta`) and/or HPOS (`wc_orders` + `wc_order_addresses` + `wc_order_operational_data`) accordingly — both stores when data-sync is on. Resolves line prices from each product's `_price`; reads currency / decimals / WooCommerce version from `wp_options`; generates the order key.

  ```ts
  const order = await Order.createOrder({
    lines: [{ productId: 14812, quantity: 2 }],
    billing: { first_name: 'Khách', phone: '0900000000', address_1: '123 ...', city: 'TP.HCM', country: 'VN' },
    customerId: 42,         // 0 = guest
    status: 'processing',   // default (without the `wc-` prefix)
    paymentMethod: 'cod',
  });
  ```

  New exports: `CreateOrderInput`, `OrderLineInput`, `OrderAddressInput`.

  ⚠️ A direct DB insert does **not** run WooCommerce hooks → no confirmation emails, no stock reduction, and the WC Analytics lookup tables aren't updated until regenerated (the classic Orders screen shows the order fine). Tax / shipping / coupons are written as `0`. Use the WC REST API if you need those handled automatically.

## 0.4.0

### Patch changes

- Bumps `@kieusonlam/wp-core` peer dependency to `^0.4.0`. No code changes — release coordinated with wp-core 0.4.0 (adds `.whereIn()` / `.whereNotIn()` + `Op` re-export) to keep all 3 packages on the same minor version.

  When upgrading: `pnpm add @kieusonlam/wp-core@^0.4.0 @kieusonlam/wp-woocommerce@^0.4.0` (same for npm/yarn).

## 0.3.0

### Patch changes

- Bumps `@kieusonlam/wp-core` peer dependency to `^0.3.0`. No code changes — release coordinated with wp-core to keep all 3 packages on the same minor version.

  When upgrading: `pnpm add @kieusonlam/wp-core@^0.3.0 @kieusonlam/wp-woocommerce@^0.3.0` (same for npm/yarn).

## 0.2.0

Initial public release.

- **Product** — SKU, price (regular/sale/effective), stock status, dimensions, weight, gallery, cross-sells, upsells
- **Variation** — `post_type='product_variation'` typed wrapper
- **Order** — line items, customer ID, currency, totals, status scopes (`pending`, `processing`, `completed`, `cancelled`, etc.)
- **Item** — `wp_woocommerce_order_items` + `wp_woocommerce_order_itemmeta` line item reader
- **Customer** — `User` enriched with `.orders()`, `.orderCount()`, billing/shipping address loaders
- **Coupon** — discount type, amount, expiry, usage tracking
- **ProductCategory / ProductTag** — Taxonomy subclasses
- **BillingAddress / ShippingAddress / Payment** — aggregate `_billing_*` / `_shipping_*` / `_payment_*` meta into typed structs with `.format()`
- TypeScript-first, ESM + CJS output, MIT licensed
- Targets legacy postmeta order storage (NOT HPOS — see README)
