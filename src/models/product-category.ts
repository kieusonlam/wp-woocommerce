/**
 * `ProductCategory` — taxonomy=`product_cat`.
 * `ProductTag`      — taxonomy=`product_tag`.
 */

import { Taxonomy, type WpConnection } from '@kieusonlam/wp-core';
import type { FindOptions } from 'sequelize';

export class ProductCategory extends Taxonomy {
  static override defaultTaxonomy = 'product_cat';

  static all(options: FindOptions = {}, connection?: WpConnection): Promise<Taxonomy[]> {
    return Taxonomy.named('product_cat', options, connection);
  }

  static findBySlug(slug: string, connection?: WpConnection): Promise<Taxonomy | null> {
    return Taxonomy.slug('product_cat', slug, connection);
  }
}

export class ProductTag extends Taxonomy {
  static override defaultTaxonomy = 'product_tag';

  static all(options: FindOptions = {}, connection?: WpConnection): Promise<Taxonomy[]> {
    return Taxonomy.named('product_tag', options, connection);
  }

  static findBySlug(slug: string, connection?: WpConnection): Promise<Taxonomy | null> {
    return Taxonomy.slug('product_tag', slug, connection);
  }
}
