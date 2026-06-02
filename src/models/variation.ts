import { Post } from '@kieusonlam/wp-core';

/**
 * `Variation` — `post_type='product_variation'`, child of a Product.
 */
export class Variation extends Post {
  static override defaultType = 'product_variation';

  get sku(): string {
    return (this.getMeta('_sku') as string) ?? '';
  }
  get price(): string {
    return (this.getMeta('_price') as string) ?? '';
  }
  get regularPrice(): string {
    return (this.getMeta('_regular_price') as string) ?? '';
  }
  get salePrice(): string {
    return (this.getMeta('_sale_price') as string) ?? '';
  }
  /** Parent product ID. */
  get productId(): number {
    return this.parentId;
  }
}
