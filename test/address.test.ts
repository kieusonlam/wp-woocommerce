import { describe, expect, it } from 'vitest';
import { BillingAddress, ShippingAddress, Payment } from '../src/helpers/address.js';

describe('BillingAddress', () => {
  it('extracts every _billing_* field', () => {
    const meta = {
      _billing_first_name: 'Nguyễn',
      _billing_last_name: 'Văn A',
      _billing_company: 'POTECH',
      _billing_address_1: '350/33/10/9B QL1',
      _billing_address_2: 'KP4',
      _billing_city: 'HCM',
      _billing_state: 'TP. HCM',
      _billing_postcode: '700000',
      _billing_country: 'VN',
      _billing_email: 'test@example.com',
      _billing_phone: '0912122016',
    };
    const ba = new BillingAddress(meta);
    expect(ba.first_name).toBe('Nguyễn');
    expect(ba.city).toBe('HCM');
    expect(ba.format()).toContain('Nguyễn Văn A');
    expect(ba.format()).toContain('350/33/10/9B QL1');
  });

  it('handles missing meta gracefully', () => {
    const ba = new BillingAddress({});
    expect(ba.first_name).toBe('');
    expect(ba.format()).toBe('');
  });
});

describe('ShippingAddress', () => {
  it('extracts every _shipping_* field', () => {
    const meta = {
      _shipping_first_name: 'B',
      _shipping_last_name: 'C',
      _shipping_address_1: 'Long An',
      _shipping_city: 'Tân An',
      _shipping_country: 'VN',
    };
    const sa = new ShippingAddress(meta);
    expect(sa.first_name).toBe('B');
    expect(sa.city).toBe('Tân An');
  });
});

describe('Payment', () => {
  it('extracts payment meta', () => {
    const meta = {
      _payment_method: 'cod',
      _payment_method_title: 'Cash on delivery',
      _transaction_id: 'TXN-001',
    };
    const p = new Payment(meta);
    expect(p.method).toBe('cod');
    expect(p.method_title).toBe('Cash on delivery');
    expect(p.transaction_id).toBe('TXN-001');
  });
});
