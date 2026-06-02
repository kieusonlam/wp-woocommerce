/**
 * `Coupon` — post_type=`shop_coupon`.
 */

import { Post } from '@kieusonlam/wp-core';

export class Coupon extends Post {
  static override defaultType = 'shop_coupon';

  /** `fixed_cart` | `percent` | `fixed_product` | `percent_product`. */
  get discountType(): string {
    return (this.getMeta('discount_type') as string) ?? '';
  }

  get amount(): string {
    return (this.getMeta('coupon_amount') as string) ?? '0';
  }

  get expiryDate(): string {
    return (this.getMeta('expiry_date') as string) ?? '';
  }

  get usageCount(): number {
    const v = this.getMeta('usage_count');
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseInt(v, 10) || 0;
    return 0;
  }

  get usageLimit(): number | null {
    const v = this.getMeta('usage_limit');
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '') {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  /** Whether the coupon has expired (yyyy-mm-dd or numeric timestamp). */
  get isExpired(): boolean {
    const exp = this.expiryDate;
    if (!exp) return false;
    const ts = Date.parse(exp);
    if (!Number.isFinite(ts)) return false;
    return ts < Date.now();
  }
}
