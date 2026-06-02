/**
 * Billing/Shipping/Payment helpers — aggregate `_billing_*`, `_shipping_*`,
 * `_payment_*` meta into structured objects.
 */

import type { MetaValue } from '@kieusonlam/wp-core';

export interface AddressShape {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

function strMeta(meta: Record<string, MetaValue>, key: string): string {
  const v = meta[key];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export class BillingAddress implements AddressShape {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email: string;
  phone: string;

  constructor(meta: Record<string, MetaValue>) {
    this.first_name = strMeta(meta, '_billing_first_name');
    this.last_name = strMeta(meta, '_billing_last_name');
    this.company = strMeta(meta, '_billing_company');
    this.address_1 = strMeta(meta, '_billing_address_1');
    this.address_2 = strMeta(meta, '_billing_address_2');
    this.city = strMeta(meta, '_billing_city');
    this.state = strMeta(meta, '_billing_state');
    this.postcode = strMeta(meta, '_billing_postcode');
    this.country = strMeta(meta, '_billing_country');
    this.email = strMeta(meta, '_billing_email');
    this.phone = strMeta(meta, '_billing_phone');
  }

  /** Pretty-print a single-line address. */
  format(): string {
    return [
      [this.first_name, this.last_name].filter(Boolean).join(' '),
      this.company,
      this.address_1,
      this.address_2,
      [this.city, this.state, this.postcode].filter(Boolean).join(', '),
      this.country,
    ]
      .filter(Boolean)
      .join(', ');
  }
}

export class ShippingAddress implements AddressShape {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;

  constructor(meta: Record<string, MetaValue>) {
    this.first_name = strMeta(meta, '_shipping_first_name');
    this.last_name = strMeta(meta, '_shipping_last_name');
    this.company = strMeta(meta, '_shipping_company');
    this.address_1 = strMeta(meta, '_shipping_address_1');
    this.address_2 = strMeta(meta, '_shipping_address_2');
    this.city = strMeta(meta, '_shipping_city');
    this.state = strMeta(meta, '_shipping_state');
    this.postcode = strMeta(meta, '_shipping_postcode');
    this.country = strMeta(meta, '_shipping_country');
  }

  format(): string {
    return [
      [this.first_name, this.last_name].filter(Boolean).join(' '),
      this.company,
      this.address_1,
      this.address_2,
      [this.city, this.state, this.postcode].filter(Boolean).join(', '),
      this.country,
    ]
      .filter(Boolean)
      .join(', ');
  }
}

export class Payment {
  method: string;
  method_title: string;
  transaction_id: string;
  paid_at: string;

  constructor(meta: Record<string, MetaValue>) {
    this.method = strMeta(meta, '_payment_method');
    this.method_title = strMeta(meta, '_payment_method_title');
    this.transaction_id = strMeta(meta, '_transaction_id');
    this.paid_at = strMeta(meta, '_paid_date');
  }
}
