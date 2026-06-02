/**
 * `Item` — one row in `${prefix}woocommerce_order_items` + its meta in
 * `${prefix}woocommerce_order_itemmeta`.
 *
 * Because these tables aren't part of WP core, we define ad-hoc Sequelize
 * models here on the active connection.
 */

import {
  DataTypes,
  Model,
  type ModelStatic,
  type Sequelize,
} from 'sequelize';
import { getConnection, maybeUnserialize, type MetaValue, type WpConnection } from '@kieusonlam/wp-core';

interface OrderItemAttrs {
  order_item_id: number;
  order_item_name: string;
  order_item_type: string;
  order_id: number;
}
type OrderItemInstance = Model<OrderItemAttrs, Partial<OrderItemAttrs>> & OrderItemAttrs;

interface OrderItemMetaAttrs {
  meta_id: number;
  order_item_id: number;
  meta_key: string;
  meta_value: string;
}
type OrderItemMetaInstance = Model<OrderItemMetaAttrs, Partial<OrderItemMetaAttrs>> &
  OrderItemMetaAttrs;

const REGISTRY = new WeakMap<
  WpConnection,
  { Item: ModelStatic<OrderItemInstance>; ItemMeta: ModelStatic<OrderItemMetaInstance> }
>();

function defineModels(conn: WpConnection) {
  const cached = REGISTRY.get(conn);
  if (cached) return cached;
  const sequelize: Sequelize = conn.sequelize;
  const prefix = conn.prefix;

  const ItemModel = sequelize.define<OrderItemInstance>(
    'WooOrderItem',
    {
      order_item_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      order_item_name: { type: DataTypes.TEXT, allowNull: false },
      order_item_type: { type: DataTypes.STRING(200), allowNull: false, defaultValue: '' },
      order_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    { tableName: `${prefix}woocommerce_order_items`, timestamps: false, freezeTableName: true },
  );

  const ItemMetaModel = sequelize.define<OrderItemMetaInstance>(
    'WooOrderItemMeta',
    {
      meta_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      order_item_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      meta_key: { type: DataTypes.STRING(255), allowNull: false },
      meta_value: { type: DataTypes.TEXT('long'), allowNull: false },
    },
    { tableName: `${prefix}woocommerce_order_itemmeta`, timestamps: false, freezeTableName: true },
  );

  ItemModel.hasMany(ItemMetaModel, { foreignKey: 'order_item_id', as: 'meta' });
  ItemMetaModel.belongsTo(ItemModel, { foreignKey: 'order_item_id', as: 'item' });

  const bundle = { Item: ItemModel, ItemMeta: ItemMetaModel };
  REGISTRY.set(conn, bundle);
  return bundle;
}

export class Item {
  protected readonly raw: OrderItemInstance;
  protected readonly conn: WpConnection;
  /** Eager-loaded meta keyed by meta_key. */
  protected readonly metaMap: Record<string, MetaValue>;

  constructor(raw: OrderItemInstance, conn: WpConnection) {
    this.raw = raw;
    this.conn = conn;
    const metaRows = (raw.get('meta') as OrderItemMetaInstance[] | undefined) ?? [];
    this.metaMap = {};
    for (const m of metaRows) {
      const key = m.get('meta_key') as string;
      const raw = m.get('meta_value');
      this.metaMap[key] = typeof raw === 'string' ? maybeUnserialize(raw) : (raw as MetaValue);
    }
  }

  get id(): number {
    return this.raw.order_item_id;
  }
  get orderId(): number {
    return this.raw.order_id;
  }
  get name(): string {
    return this.raw.order_item_name;
  }
  get type(): string {
    return this.raw.order_item_type;
  }
  get productId(): number {
    return parseMetaNumber(this.metaMap._product_id);
  }
  get variationId(): number {
    return parseMetaNumber(this.metaMap._variation_id);
  }
  get quantity(): number {
    return parseMetaNumber(this.metaMap._qty);
  }
  get lineSubtotal(): string {
    return String(this.metaMap._line_subtotal ?? '0');
  }
  get lineSubtotalTax(): string {
    return String(this.metaMap._line_subtotal_tax ?? '0');
  }
  get lineTotal(): string {
    return String(this.metaMap._line_total ?? '0');
  }
  get lineTax(): string {
    return String(this.metaMap._line_tax ?? '0');
  }

  /** All line items + meta for a given order. */
  static async forOrder(orderId: number, connection?: WpConnection): Promise<Item[]> {
    const conn = connection ?? getConnection();
    const { Item: ItemModel, ItemMeta } = defineModels(conn);
    const rows = await ItemModel.findAll({
      where: { order_id: orderId, order_item_type: 'line_item' },
      include: [{ model: ItemMeta, as: 'meta' }],
    });
    return rows.map((r) => new Item(r, conn));
  }
}

function parseMetaNumber(v: MetaValue | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
