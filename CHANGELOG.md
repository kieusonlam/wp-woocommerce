# @kieusonlam/wp-woocommerce

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
