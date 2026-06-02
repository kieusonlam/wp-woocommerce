/**
 * @kieusonlam/wp-woocommerce — WooCommerce models layered on @kieusonlam/wp-core.
 *
 * Quickstart:
 *
 *   import { connect } from '@kieusonlam/wp-core';
 *   import { Product, Order, Customer } from '@kieusonlam/wp-woocommerce';
 *
 *   connect({ ... });
 *
 *   const product = await Product.published().slug('led-bulb-a19').first();
 *   console.log(product?.price, product?.sku);
 *
 *   const recent  = await Order.completed().newest().limit(10).all();
 *   const c       = await Customer.find(123);
 *   const orders  = await c?.orders();
 */

export { Product } from './models/product.js';
export { Variation } from './models/variation.js';
export { Order } from './models/order.js';
export { Item } from './models/item.js';
export { Customer } from './models/customer.js';
export { Coupon } from './models/coupon.js';
export { ProductCategory, ProductTag } from './models/product-category.js';
export {
  BillingAddress,
  ShippingAddress,
  Payment,
  type AddressShape,
} from './helpers/address.js';
