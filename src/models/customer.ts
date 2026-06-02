/**
 * `Customer` — a `User` enriched with order-history accessors.
 */

import { Op, type WhereOptions } from 'sequelize';
import { User, type MetaValue, type WpConnection, getConnection } from '@kieusonlam/wp-core';
import { Order } from './order.js';
import { BillingAddress, ShippingAddress } from '../helpers/address.js';

export class Customer extends User {
  /** All orders attached to this customer. */
  async orders(connection?: WpConnection): Promise<Order[]> {
    const conn = connection ?? getConnection();
    return Order.query(conn)
      .type('shop_order')
      .hasMeta('_customer_user', String(this.ID))
      .all();
  }

  async orderCount(connection?: WpConnection): Promise<number> {
    const conn = connection ?? getConnection();
    return Order.query(conn)
      .type('shop_order')
      .hasMeta('_customer_user', String(this.ID))
      .count();
  }

  /** Build a billing address from the user's stored profile meta. */
  async billingAddress(): Promise<BillingAddress> {
    const map: Record<string, MetaValue> = {};
    for (const key of [
      '_billing_first_name',
      '_billing_last_name',
      '_billing_company',
      '_billing_address_1',
      '_billing_address_2',
      '_billing_city',
      '_billing_state',
      '_billing_postcode',
      '_billing_country',
      '_billing_email',
      '_billing_phone',
    ]) {
      // user meta stores them without the leading underscore
      const name = key.slice(1);
      const v = await this.getMetaAsync(name);
      if (v !== undefined) map[key] = v;
    }
    return new BillingAddress(map);
  }

  async shippingAddress(): Promise<ShippingAddress> {
    const map: Record<string, MetaValue> = {};
    for (const key of [
      '_shipping_first_name',
      '_shipping_last_name',
      '_shipping_company',
      '_shipping_address_1',
      '_shipping_address_2',
      '_shipping_city',
      '_shipping_state',
      '_shipping_postcode',
      '_shipping_country',
    ]) {
      const name = key.slice(1);
      const v = await this.getMetaAsync(name);
      if (v !== undefined) map[key] = v;
    }
    return new ShippingAddress(map);
  }

  static async find(id: number, connection?: WpConnection): Promise<Customer | null> {
    const u = await User.find(id, connection);
    if (!u) return null;
    return new Customer(u.raw, connection);
  }
}
