/**
 * `Order` — WooCommerce order (post_type=`shop_order` for legacy DB; some
 * WC versions use `wc_orders` as a separate table — we cover the legacy
 * meta-driven path because that's still the dominant deployment).
 */

import {
  getConnection,
  Post,
  type WpConnection,
  type MetaValue,
} from '@kieusonlam/wp-core';
import { Op, type WhereOptions } from 'sequelize';
import { BillingAddress, ShippingAddress, Payment } from '../helpers/address.js';
import { Item } from './item.js';

export class Order extends Post {
  static override defaultType = 'shop_order';

  get currency(): string {
    return (this.getMeta('_order_currency') as string) ?? '';
  }
  get total(): string {
    return (this.getMeta('_order_total') as string) ?? '0';
  }
  get tax(): string {
    return (this.getMeta('_order_tax') as string) ?? '0';
  }
  get shippingTotal(): string {
    return (this.getMeta('_order_shipping') as string) ?? '0';
  }
  get customerId(): number {
    const v = this.getMeta('_customer_user');
    return typeof v === 'string' ? parseInt(v, 10) || 0 : (v as number) ?? 0;
  }
  /** Order status mirrors post_status with `wc-` prefix stripped. */
  get orderStatus(): string {
    return this.status.replace(/^wc-/, '');
  }

  get billingAddress(): BillingAddress {
    return new BillingAddress(this.meta as Record<string, MetaValue>);
  }
  get shippingAddress(): ShippingAddress {
    return new ShippingAddress(this.meta as Record<string, MetaValue>);
  }
  get payment(): Payment {
    return new Payment(this.meta as Record<string, MetaValue>);
  }

  /** Load all line items + their meta. */
  async items(): Promise<Item[]> {
    return Item.forOrder(this.ID, this.conn);
  }

  // ----- scopes -----------------------------------------------------------

  static pending(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-pending' });
  }
  static processing(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-processing' });
  }
  static onHold(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-on-hold' });
  }
  static completed(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-completed' });
  }
  static cancelled(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-cancelled' });
  }
  static refunded(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-refunded' });
  }
  static failed(connection?: WpConnection) {
    return Order.query(connection).where({ post_status: 'wc-failed' });
  }
}

// Re-export for star import convenience
export { BillingAddress, ShippingAddress, Payment };
