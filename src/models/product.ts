/**
 * `Product` — WooCommerce product (post_type=`product`).
 *
 * Most attributes live in postmeta. We expose them as typed getters.
 */

import { Attachment, Post, type Taxonomy } from '@kieusonlam/wp-core';

export class Product extends Post {
  static override defaultType = 'product';

  /** SKU stored as `_sku` meta. */
  get sku(): string {
    return (this.getMeta('_sku') as string) ?? '';
  }

  /** Regular price (string in cents/decimals — WC stores as-is). */
  get regularPrice(): string {
    return (this.getMeta('_regular_price') as string) ?? '';
  }

  get salePrice(): string {
    return (this.getMeta('_sale_price') as string) ?? '';
  }

  /** Current effective price (sale price if set, else regular). */
  get price(): string {
    return (this.getMeta('_price') as string) ?? this.regularPrice;
  }

  /** Whether the product is currently on sale. */
  get onSale(): boolean {
    const sale = this.salePrice;
    return !!sale && sale !== this.regularPrice;
  }

  get stockStatus(): string {
    return (this.getMeta('_stock_status') as string) ?? 'instock';
  }

  get manageStock(): boolean {
    const v = this.getMeta('_manage_stock');
    return v === 'yes';
  }

  get stock(): number | null {
    const v = this.getMeta('_stock');
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v !== '') {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  get inStock(): boolean {
    return this.stockStatus === 'instock';
  }

  get weight(): string {
    return (this.getMeta('_weight') as string) ?? '';
  }

  get dimensions(): { length: string; width: string; height: string } {
    return {
      length: (this.getMeta('_length') as string) ?? '',
      width: (this.getMeta('_width') as string) ?? '',
      height: (this.getMeta('_height') as string) ?? '',
    };
  }

  /** Cross-sell IDs (`_crosssell_ids` is a PHP-array of post IDs). */
  get crossSellIds(): number[] {
    return coerceIdList(this.getMeta('_crosssell_ids'));
  }

  get upsellIds(): number[] {
    return coerceIdList(this.getMeta('_upsell_ids'));
  }

  /** Gallery attachment IDs from `_product_image_gallery` (CSV string). */
  get galleryIds(): number[] {
    const raw = this.getMeta('_product_image_gallery');
    if (typeof raw !== 'string' || raw.length === 0) return [];
    return raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }

  /** Load gallery attachments. */
  async gallery(): Promise<Attachment[]> {
    const out: Attachment[] = [];
    for (const id of this.galleryIds) {
      const a = await Attachment.find(id);
      if (a) out.push(a as Attachment);
    }
    return out;
  }

  /** Eager-loaded categories (when query used `.withTaxonomies('product_cat')`). */
  categories(): Taxonomy[] {
    return this.taxonomies.filter((t) => t.taxonomy === 'product_cat').map((t) => t as unknown as Taxonomy);
  }

  /** Eager-loaded tags (taxonomy=`product_tag`). */
  tags(): Taxonomy[] {
    return this.taxonomies.filter((t) => t.taxonomy === 'product_tag').map((t) => t as unknown as Taxonomy);
  }
}

function coerceIdList(value: unknown): number[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
      .filter((n) => Number.isFinite(n));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
      .filter((n) => Number.isFinite(n));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}
