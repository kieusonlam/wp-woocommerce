# @kieusonlam/wp-woocommerce

> Product, Order, Customer, Item, Coupon models for any WordPress + WooCommerce database — in Node.js / TypeScript. Read prices, stock, line items, billing/shipping addresses, and order history directly from MySQL without touching the WC REST API.

[![npm](https://img.shields.io/npm/v/@kieusonlam/wp-woocommerce?color=blue)](https://www.npmjs.com/package/@kieusonlam/wp-woocommerce)
[![license](https://img.shields.io/npm/l/@kieusonlam/wp-woocommerce)](./LICENSE)

---

## Install

```sh
pnpm add @kieusonlam/wp-core @kieusonlam/wp-woocommerce
```

> Requires [`@kieusonlam/wp-core`](https://github.com/kieusonlam/wp-core) as a peer dep — the DB connection and Post model come from there.

---

## Quickstart

```ts
import { connect } from '@kieusonlam/wp-core';
import { Product, Order, Customer, Coupon } from '@kieusonlam/wp-woocommerce';

connect({
  host: '127.0.0.1',
  user: 'wp_user',
  password: process.env.DB_PASS!,
  database: 'wordpress',
  prefix: 'wp_',
});

// A product
const product = await Product.published().slug('led-bulb-a19').withMeta().first();
console.log(product?.sku, product?.price, product?.stockStatus);

// Recent completed orders
const recent = await Order.completed().newest().withMeta().limit(10).all();
for (const o of recent) {
  console.log(o.orderStatus, o.currency, o.total);
  console.log(o.billingAddress.format());
  for (const item of await o.items()) {
    console.log(item.name, item.quantity, item.lineTotal);
  }
}

// A customer + their order history
const c = await Customer.find(123);
const orders = await c?.orders();
const count = await c?.orderCount();
```

---

## Table of contents

- [Compatibility](#compatibility)
- [`Product`](#product)
- [`Variation`](#variation)
- [`ProductCategory` / `ProductTag`](#product-cat-tag)
- [`Order`](#order)
- [`Item` (order line item)](#item)
- [`Customer`](#customer)
- [`Coupon`](#coupon)
- [Address helpers](#address)
- [Scopes & queries](#scopes)
- [Write path](#write)
- [TypeScript](#typescript)
- [Recipes](#recipes)
- [FAQ](#faq)

---

<a id="compatibility"></a>
## ⚠️ Compatibility note (WooCommerce HPOS)

WooCommerce 8.x introduced **High-Performance Order Storage (HPOS)** which moves orders out of `wp_posts` into separate `wp_wc_orders*` tables.

- **`Order.findOrder(id)` / `Order.forCustomer(customerId)` (reads, v0.4.2+)** and **[`Order.createOrder()`](#-write-path) (writes, v0.4.1+)** **auto-detect** the storage mode and use legacy `wp_posts`/`postmeta` and/or HPOS `wc_orders*` accordingly (both when data-sync is on). → **HPOS works out of the box.**
- The lower-level builder **`Order.query()…`** still targets **legacy postmeta only**. On an HPOS-only site (enabled `yes`, data-sync **off**) it returns nothing — use `findOrder` / `forCustomer` instead.

Check your site's mode:

```sql
SELECT option_name, option_value FROM wp_options
 WHERE option_name IN ('woocommerce_custom_orders_table_enabled',           -- 'yes' = HPOS is the source of truth
                       'woocommerce_custom_orders_table_data_sync_enabled'); -- 'yes' = both stores kept in sync
```

---

<a id="product"></a>
## 🛍 `Product` — `post_type='product'`

Extends `Post` — every Post method (`published()`, `slug()`, `taxonomy()`, `withMeta()`, …) works.

```ts
import { Product } from '@kieusonlam/wp-woocommerce';

const p = await Product.slug('led-highbay-200w').withMeta().firstOrFail();

p.sku;             // "PT-HB-200-DA"
p.regularPrice;    // "2500000"
p.salePrice;       // "1990000"
p.price;           // "1990000"            (effective: sale if set, else regular)
p.onSale;          // true
p.stockStatus;     // "instock"            ("instock" | "outofstock" | "onbackorder")
p.manageStock;     // false
p.stock;           // null                 (number when manageStock = true)
p.inStock;         // true
p.weight;          // "3.5"
p.dimensions;      // { length: "30", width: "30", height: "12" }   (cm by default)

p.galleryIds;      // [502, 503, 504, 505]
const photos = await p.gallery();    // → Attachment[]

p.crossSellIds;    // [801, 802]
p.upsellIds;       // [803]

// Eager-load categories + tags in the query:
await Product.published().withTaxonomies(['product_cat', 'product_tag']).all();
// Then on each instance:
p.categories();    // → Taxonomy[] for product_cat
p.tags();          // → Taxonomy[] for product_tag
```

**Response sample** — `Product.slug('led-highbay-200w').withMeta().first()`:

```jsonc
{
  "ID":            512,
  "title":         "Đèn LED highbay 200W POTECH PT-HB-200-DA",
  "slug":          "led-highbay-200w",
  "type":          "product",
  "status":        "publish",
  "date":          "2026-03-15 14:00:00",

  // Product-specific getters:
  "sku":           "PT-HB-200-DA",
  "regularPrice":  "2500000",
  "salePrice":     "1990000",
  "price":         "1990000",
  "onSale":        true,
  "stockStatus":   "instock",
  "stock":         null,
  "weight":        "3.5",
  "dimensions":    { "length": "30", "width": "30", "height": "12" },
  "galleryIds":    [502, 503, 504, 505],

  // With .withMeta() — full postmeta map:
  "meta": {
    "_sku":                    "PT-HB-200-DA",
    "_price":                  "1990000",
    "_regular_price":          "2500000",
    "_sale_price":             "1990000",
    "_stock_status":           "instock",
    "_product_image_gallery":  "502,503,504,505",
    "_weight":                 "3.5",
    "_length":                 "30",
    "_thumbnail_id":           "501"
  }
}
```

---

<a id="variation"></a>
## 🎨 `Variation` — `post_type='product_variation'`

Children of a Product. Each combination of attributes is one row.

```ts
import { Variation } from '@kieusonlam/wp-woocommerce';

const variations = await Variation.published().parent(512).withMeta().all();
for (const v of variations) {
  v.sku;           // "PT-HB-200-DA-CW"     (size/color appended)
  v.price;         // "1990000"
  v.regularPrice;  // "2500000"
  v.salePrice;     // "1990000"
  v.productId;     // 512
  v.meta.attribute_pa_color;   // "cool-white"
  v.meta.attribute_pa_size;    // "200W"
}
```

---

<a id="product-cat-tag"></a>
## 🏷 `ProductCategory` / `ProductTag`

`Taxonomy` subclasses scoped to `product_cat` / `product_tag`.

```ts
import { ProductCategory, ProductTag } from '@kieusonlam/wp-woocommerce';

const cats = await ProductCategory.all();
const led = await ProductCategory.slug('led-cong-nghiep').first();
const productsInCat = await led?.posts();        // Post[] (filter to Product as needed)
```

---

<a id="order"></a>
## 📦 `Order` — `post_type='shop_order'`

```ts
import { Order } from '@kieusonlam/wp-woocommerce';

const o = await Order.query().withMeta().where({ ID: 1024 }).firstOrFail();

o.ID;              // 1024
o.orderStatus;     // "completed"           (post_status sans the "wc-" prefix)
o.currency;        // "VND"
o.total;           // "9950000"
o.tax;             // "896409"
o.shippingTotal;   // "0"
o.customerId;      // 42

o.billingAddress;  // BillingAddress {...}
o.shippingAddress; // ShippingAddress {...}
o.payment;         // Payment {...}

// Line items
const items = await o.items();
// → Item[]
```

### HPOS-aware reads — `findOrder` / `forCustomer`

`Order.query()` above reads **legacy postmeta** only. For code that must also work on **HPOS** sites, use these auto-detecting helpers — they return the same `Order` (all getters + `.items()`):

```ts
const order    = await Order.findOrder(1024);   // by id — legacy or HPOS, auto-detected
const myOrders = await Order.forCustomer(42);   // a customer's orders, newest first

await Order.findOrderHpos(1024);                // force an HPOS read (advanced / testing)
```

### Status scopes

```ts
await Order.pending().all();      // wc-pending
await Order.processing().all();   // wc-processing
await Order.onHold().all();       // wc-on-hold
await Order.completed().all();    // wc-completed
await Order.cancelled().all();    // wc-cancelled
await Order.refunded().all();     // wc-refunded
await Order.failed().all();       // wc-failed
```

**Response sample** — `Order.find(1024).withMeta()`:

```jsonc
{
  "ID":             1024,
  "orderStatus":    "completed",
  "currency":       "VND",
  "total":          "9950000",
  "tax":            "896409",
  "shippingTotal":  "0",
  "customerId":     42,

  "billingAddress": {
    "first_name": "Lâm",
    "last_name":  "Kiều",
    "company":    "POTECH",
    "address_1":  "123 Nguyễn Trãi",
    "address_2":  "Tầng 5",
    "city":       "Hồ Chí Minh",
    "state":      "HCM",
    "postcode":   "700000",
    "country":    "VN",
    "email":      "rainbow.lam25@gmail.com",
    "phone":      "+84 903 123 456"
  },

  "shippingAddress": { /* same shape as billingAddress (no email/phone) */ },

  "payment": {
    "method":       "bacs",
    "methodTitle":  "Chuyển khoản ngân hàng",
    "transactionId": ""
  },

  // Line items via await o.items():
  "items": [
    {
      "id":          5001,
      "name":        "Đèn LED highbay 200W POTECH × 2",
      "type":        "line_item",
      "productId":   512,
      "variationId": 0,
      "quantity":    2,
      "lineSubtotal": "3980000",
      "lineTotal":    "3980000",
      "lineTax":      "318400"
    },
    {
      "id":          5002,
      "name":        "Đèn LED panel 600x600 36W × 5",
      "productId":   534,
      "quantity":    5,
      "lineTotal":   "5970000"
    }
  ]
}
```

---

<a id="item"></a>
## 🧾 `Item` — order line item

Backed by `wp_woocommerce_order_items` + `wp_woocommerce_order_itemmeta`.

```ts
import { Item } from '@kieusonlam/wp-woocommerce';

const items = await Item.forOrder(1024);
for (const item of items) {
  item.id;            // 5001
  item.name;          // "Đèn LED highbay 200W POTECH × 2"
  item.type;          // "line_item"  ("line_item" | "shipping" | "tax" | "fee" | "coupon")
  item.orderId;       // 1024
  item.productId;     // 512
  item.variationId;   // 0
  item.quantity;      // 2
  item.lineSubtotal;  // "3980000"
  item.lineTotal;     // "3980000"
  item.lineTax;       // "318400"

  // Raw meta access (Sequelize-style)
  item.getMeta('_product_id');       // "512"
  await item.product();              // → Product | null
}
```

---

<a id="customer"></a>
## 👤 `Customer` — `User` with order history

```ts
import { Customer } from '@kieusonlam/wp-woocommerce';

const c = await Customer.find(42) as Customer;

c.login;         // "rainbow_lam"
c.email;         // "rainbow.lam25@gmail.com"
c.displayName;   // "Lâm Kiều"

await c.orderCount();        // → 12
await c.orders();            // → Order[]    (post_type=shop_order, _customer_user=42)

const billing = await c.billingAddress();
billing.format();
// → "Lâm Kiều, POTECH, 123 Nguyễn Trãi, Tầng 5, Hồ Chí Minh, HCM 700000, VN"

const shipping = await c.shippingAddress();
```

---

<a id="coupon"></a>
## 🎟 `Coupon` — `post_type='shop_coupon'`

```ts
import { Coupon } from '@kieusonlam/wp-woocommerce';

const c = await Coupon.slug('summer2026').withMeta().firstOrFail();

c.discountType;     // "percent"  ("fixed_cart" | "percent" | "fixed_product" | "percent_product")
c.amount;           // "15"
c.expiryDate;       // "2026-08-31"
c.usageCount;       // 42
c.usageLimit;       // 100        (number | null)
c.isExpired;        // false
```

**Response sample**:

```jsonc
{
  "ID":            2048,
  "title":         "SUMMER2026",
  "slug":          "summer2026",
  "discountType":  "percent",
  "amount":        "15",
  "expiryDate":    "2026-08-31",
  "usageCount":    42,
  "usageLimit":    100,
  "isExpired":     false
}
```

---

<a id="address"></a>
## 🏠 Address helpers

`BillingAddress` / `ShippingAddress` / `Payment` aggregate the dozen `_billing_*` / `_shipping_*` / `_payment_*` meta rows into typed structs.

```ts
import { BillingAddress, ShippingAddress, Payment } from '@kieusonlam/wp-woocommerce';

const addr = order.billingAddress;
addr.first_name;
addr.last_name;
addr.company;
addr.address_1;
addr.address_2;
addr.city;
addr.state;
addr.postcode;
addr.country;
addr.email;
addr.phone;

addr.format();
// → "Lâm Kiều, POTECH, 123 Nguyễn Trãi, Tầng 5, Hồ Chí Minh, HCM 700000, VN"

addr.toJSON();
// → AddressShape (plain object)
```

```ts
// AddressShape type:
interface AddressShape {
  first_name: string;
  last_name:  string;
  company:    string;
  address_1:  string;
  address_2:  string;
  city:       string;
  state:      string;
  postcode:   string;
  country:    string;
  email?:     string;   // BillingAddress only
  phone?:     string;   // BillingAddress only
}
```

---

<a id="scopes"></a>
## 🔍 Scopes & queries

Every WC model extends `Post`, so every Post scope is available:

```ts
import { Op } from 'sequelize';

// 50 newest products in two categories that are in stock + on sale
await Product
  .published()
  .taxonomy('product_cat', ['highbay', 'panel'])
  .hasMeta('_stock_status', 'instock')
  .hasMeta('_sale_price', '', '!=')
  .newest()
  .withMeta()
  .withTaxonomies(['product_cat', 'product_tag'])
  .paginate(50, 1);

// Orders >5M VND completed in last 30 days
await Order
  .completed()
  .where({ post_date: { [Op.gt]: '2026-05-01 00:00:00' } })
  .hasMeta('_order_total', '5000000', '>')
  .all();

// Best-selling products (order by total_sales meta)
await Product
  .published()
  .orderBy('menu_order', 'ASC')
  .limit(20)
  .all();
```

---

<a id="write"></a>
## ✍️ Write path

Products / Orders / Coupons are `Post` rows — use the standard write API:

```ts
import { getConnection } from '@kieusonlam/wp-core';

const conn = getConnection();
const PostModel = conn.sequelize.models.Post;

const raw = await PostModel.create({
  post_title:   'Đèn LED panel 600x600 36W',
  post_status:  'publish',
  post_type:    'product',
  post_name:    'led-panel-600-36w',
  post_author:  1,
});

const product = new Product(raw);
await product.saveMeta('_sku', 'PT-PN-36-DA');
await product.saveMeta('_price', '850000');
await product.saveMeta('_regular_price', '850000');
await product.saveMeta('_stock_status', 'instock');
await product.saveMeta('_product_image_gallery', '700,701,702');
```

For **orders**, use the high-level helper `Order.createOrder()` — it writes the order + line items in one transaction and **auto-detects HPOS** (see the [HPOS note](#️-compatibility-note-woocommerce-hpos) above):

```ts
import { Order } from '@kieusonlam/wp-woocommerce';

const order = await Order.createOrder({
  lines: [
    { productId: 14812, quantity: 2 },
    { productId: 15105, quantity: 1 },
  ],
  billing: {
    first_name: 'Khách', last_name: 'Mua',
    phone: '0900000000', email: 'buyer@example.com',
    address_1: '123 Đường ABC', city: 'TP.HCM', country: 'VN',
  },
  customerId: 42,         // 0 = guest
  status: 'processing',   // default; pass without the `wc-` prefix
  paymentMethod: 'cod',
});

console.log(order.ID);    // → new order id
```

Line prices come from each product's `_price`; currency / decimals / WooCommerce version are read from `wp_options`; the order key is generated automatically. Input types: `CreateOrderInput`, `OrderLineInput`, `OrderAddressInput`.

> ⚠️ A direct DB insert does **not** run WooCommerce hooks → no confirmation emails, no stock reduction, and WC Analytics isn't updated until regenerated. Tax / shipping / coupons are written as `0`. Use the WC REST API if you need those handled automatically.

<details>
<summary>Low-level alternative — build the order by hand</summary>

```ts
await conn.sequelize.transaction(async (t) => {
  const raw = await PostModel.create({
    post_title: `Order #${Date.now()}`,
    post_status: 'wc-processing',
    post_type:  'shop_order',
  }, { transaction: t });

  const order = new Order(raw);
  await order.saveMeta('_order_currency', 'VND', { transaction: t });
  await order.saveMeta('_order_total', '1990000', { transaction: t });
  await order.saveMeta('_customer_user', '42', { transaction: t });
  // ... add line items into wp_woocommerce_order_items / _itemmeta
});
```

</details>

---

<a id="typescript"></a>
## 🟦 TypeScript

```ts
import {
  Product,
  Variation,
  Order,
  Item,
  Customer,
  Coupon,
  ProductCategory,
  ProductTag,
  BillingAddress,
  ShippingAddress,
  Payment,
  type AddressShape,
} from '@kieusonlam/wp-woocommerce';
```

Everything is fully typed end-to-end. Chainable query builders preserve the concrete subclass — `Product.published().withMeta().first()` returns `Promise<Product | null>`, not `Promise<Post | null>`.

---

<a id="recipes"></a>
## 🍳 Recipes

### "Buy together" recommendation

```ts
const product = await Product.slug(sku).withMeta().firstOrFail();
const crossSells: Product[] = [];
for (const id of product.crossSellIds) {
  const x = await Product.find(id);
  if (x) crossSells.push(x as Product);
}
```

### Sales dashboard query

```ts
import { Op } from 'sequelize';

const monthSales = await Order
  .completed()
  .where({ post_date: { [Op.gte]: '2026-05-01 00:00:00' } })
  .withMeta()
  .all();

const revenue = monthSales.reduce((sum, o) => sum + parseFloat(o.total), 0);
const customers = new Set(monthSales.map((o) => o.customerId)).size;
```

### Out-of-stock alert

```ts
const outOfStock = await Product
  .published()
  .hasMeta('_stock_status', 'outofstock')
  .withMeta()
  .all();
console.log(`${outOfStock.length} products out of stock:`);
outOfStock.forEach((p) => console.log(`  ${p.sku}  ${p.title}`));
```

### Top customers by order value

```ts
const allOrders = await Order.completed().withMeta().all();
const byCustomer = new Map<number, number>();
for (const o of allOrders) {
  byCustomer.set(o.customerId, (byCustomer.get(o.customerId) ?? 0) + parseFloat(o.total));
}
const top10 = [...byCustomer.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);
```

---

<a id="faq"></a>
## ❓ FAQ

**My orders return empty even though I have data.**
You're probably on WooCommerce HPOS (High-Performance Order Storage). See [Compatibility](#compatibility). Disable HPOS in WC settings to use this package today.

**`product.price` is a string, not a number — why?**
WooCommerce stores prices as strings in postmeta (e.g. `"1990000"`). Parse via `parseFloat(p.price)` or `new Intl.NumberFormat(...)`. We don't auto-cast because precision matters for currency.

**How do I support multiple currencies?**
WC stores per-order currency in `_order_currency`, available as `order.currency`. Per-product currency requires a multi-currency plugin (WPML, Aelia) — read its custom meta directly via `product.getMeta('_some_plugin_meta')`.

**Variations don't show with `Product.find(id)`.**
Variations are separate posts (`post_type='product_variation'`). Query them via `Variation.published().parent(productId)`.

**Do you support WC Subscriptions / Bookings?**
Those plugins add their own post types and postmeta. Read them via `Post.type('shop_subscription')` and standard meta access — pretty getters aren't exposed by this package.

---

## Related packages

- [`@kieusonlam/wp-core`](https://github.com/kieusonlam/wp-core) — Sequelize ORM for WordPress (required peer dep)
- [`@kieusonlam/wp-acf`](https://github.com/kieusonlam/wp-acf) — Advanced Custom Fields reader

---

## License

MIT © [Lâm Kiều](https://github.com/kieusonlam)
