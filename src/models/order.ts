/**
 * `Order` — WooCommerce order (post_type=`shop_order` for legacy DB; some
 * WC versions use `wc_orders` as a separate table — we cover the legacy
 * meta-driven path because that's still the dominant deployment).
 */

import {
  getConnection,
  getModels,
  Post,
  type WpConnection,
  type MetaValue,
} from '@kieusonlam/wp-core';
import { Op, type WhereOptions } from 'sequelize';
import { BillingAddress, ShippingAddress, Payment } from '../helpers/address.js';
import { Item } from './item.js';
import { Product } from './product.js';

// ---- Tạo đơn (ghi thẳng DB) -------------------------------------------------

/** Địa chỉ billing/shipping truyền vào khi tạo đơn (mọi field optional). */
export interface OrderAddressInput {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface OrderLineInput {
  productId: number;
  quantity: number;
}

export interface CreateOrderInput {
  lines: OrderLineInput[];
  billing: OrderAddressInput;
  /** Mặc định = billing. */
  shipping?: OrderAddressInput;
  /** 0 = khách vãng lai. */
  customerId?: number;
  /** Không có tiền tố `wc-` (vd 'processing'). Mặc định 'processing'. */
  status?: string;
  paymentMethod?: string; // mặc định 'cod'
  paymentMethodTitle?: string; // mặc định 'Cash on delivery'
  customerNote?: string;
  createdVia?: string; // mặc định 'storefront'
  currency?: string; // mặc định = option woocommerce_currency
  customerIp?: string;
  customerUserAgent?: string;
}

const ADDR_FIELDS = [
  'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country',
] as const;

function generateOrderKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 13; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return 'wc_order_' + s;
}

const addr = (a: OrderAddressInput, k: string): string =>
  (a as Record<string, string | undefined>)[k] ?? '';

// ---- Đọc đơn auto-detect HPOS ----------------------------------------------

const hposModeCache = new WeakMap<WpConnection, boolean>();

/** Site có dùng HPOS làm nguồn chính không (`woocommerce_custom_orders_table_enabled='yes'`). */
async function usesHpos(conn: WpConnection): Promise<boolean> {
  const cached = hposModeCache.get(conn);
  if (cached !== undefined) return cached;
  let on = false;
  try {
    const rows = (await conn.sequelize.query(
      `SELECT option_value v FROM ${conn.prefix}options WHERE option_name='woocommerce_custom_orders_table_enabled' LIMIT 1`,
    ))[0] as Array<{ v: string }>;
    on = rows[0]?.v === 'yes';
  } catch {
    on = false;
  }
  hposModeCache.set(conn, on);
  return on;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// HPOS lưu số dạng decimal(26,8) ('400.00000000'); postmeta lưu '400'. Chuẩn hóa
// để Order.total… trả chuỗi giống legacy.
const dec = (v: any): string => {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? String(n) : '0';
};

/** Map dữ liệu HPOS (wc_orders + addresses + operational_data + meta) → map meta kiểu postmeta. */
function hposMetaMap(o: any, addresses: any[], op: any, extra: any[]): Record<string, MetaValue> {
  const m: Record<string, MetaValue> = {
    _order_currency: o.currency ?? '',
    _order_total: dec(o.total_amount),
    _order_tax: dec(o.tax_amount),
    _customer_user: String(o.customer_id ?? 0),
    _payment_method: o.payment_method ?? '',
    _payment_method_title: o.payment_method_title ?? '',
    _transaction_id: o.transaction_id ?? '',
    _billing_email: o.billing_email ?? '',
    _customer_ip_address: o.ip_address ?? '',
    _customer_user_agent: o.user_agent ?? '',
  };
  if (op) {
    m._order_key = op.order_key ?? '';
    m._order_shipping = dec(op.shipping_total_amount);
    m._order_shipping_tax = dec(op.shipping_tax_amount);
    m._cart_discount = dec(op.discount_total_amount);
    m._cart_discount_tax = dec(op.discount_tax_amount);
    m._created_via = op.created_via ?? '';
    m._order_version = op.woocommerce_version ?? '';
    m._prices_include_tax = op.prices_include_tax ? 'yes' : 'no';
    if (op.date_paid_gmt) m._paid_date = op.date_paid_gmt;
  }
  for (const a of addresses) {
    const p = a.address_type === 'shipping' ? '_shipping_' : '_billing_';
    m[`${p}first_name`] = a.first_name ?? '';
    m[`${p}last_name`] = a.last_name ?? '';
    m[`${p}company`] = a.company ?? '';
    m[`${p}address_1`] = a.address_1 ?? '';
    m[`${p}address_2`] = a.address_2 ?? '';
    m[`${p}city`] = a.city ?? '';
    m[`${p}state`] = a.state ?? '';
    m[`${p}postcode`] = a.postcode ?? '';
    m[`${p}country`] = a.country ?? '';
    if (a.email) m[`${p}email`] = a.email;
    m[`${p}phone`] = a.phone ?? '';
  }
  // Meta tùy chỉnh còn lại (vd _billing_address_index, attribution, is_vat_exempt…).
  for (const e of extra) if (e?.meta_key) m[e.meta_key] = e.meta_value;
  return m;
}

/** Dựng Order từ dữ liệu HPOS: Post "ảo" (in-memory) + metaCache → mọi getter chạy như legacy. */
function hposToOrder(conn: WpConnection, o: any, meta: Record<string, MetaValue>): Order {
  const { Post: PostModel } = getModels(conn) as any;
  const raw = PostModel.build(
    {
      ID: o.id,
      post_status: o.status,
      post_type: 'shop_order',
      post_title: `Order – ${o.date_created_gmt ?? ''}`,
      post_date: o.date_created_gmt ?? '',
      post_date_gmt: o.date_created_gmt ?? '',
      post_modified: o.date_updated_gmt ?? o.date_created_gmt ?? '',
      post_modified_gmt: o.date_updated_gmt ?? o.date_created_gmt ?? '',
      post_author: Number(o.customer_id ?? 0),
      post_excerpt: o.customer_note ?? '',
      post_parent: Number(o.parent_order_id ?? 0),
    },
    { isNewRecord: false },
  );
  const order = new Order(raw, conn);
  (order as unknown as { metaCache: Record<string, MetaValue> }).metaCache = meta;
  return order;
}

/** Đọc 1 đơn từ bộ bảng HPOS (`wc_orders` + addresses + operational_data + meta). */
async function loadHposOrder(conn: WpConnection, id: number): Promise<Order | null> {
  const P = conn.prefix;
  const seq = conn.sequelize;
  const orows = (await seq.query(`SELECT * FROM ${P}wc_orders WHERE id=? AND type='shop_order' LIMIT 1`, { replacements: [id] }))[0] as any[];
  const o = orows[0];
  if (!o) return null;
  const addrs = (await seq.query(`SELECT * FROM ${P}wc_order_addresses WHERE order_id=?`, { replacements: [id] }))[0] as any[];
  const ops = (await seq.query(`SELECT * FROM ${P}wc_order_operational_data WHERE order_id=? LIMIT 1`, { replacements: [id] }))[0] as any[];
  const metas = (await seq.query(`SELECT meta_key, meta_value FROM ${P}wc_orders_meta WHERE order_id=?`, { replacements: [id] }))[0] as any[];
  return hposToOrder(conn, o, hposMetaMap(o, addrs, ops[0], metas));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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

  // ----- đọc đơn (auto-detect HPOS) ---------------------------------------

  /**
   * Tìm 1 đơn theo id — **tự phát hiện HPOS**:
   *   - HPOS bật (`woocommerce_custom_orders_table_enabled='yes'`) → đọc từ `wc_orders*`.
   *   - ngược lại → đọc legacy `wp_posts`/`postmeta` (kèm meta).
   * Order trả về có đầy đủ getter (currency/total/billing/shipping/payment/…) + `.items()`.
   *
   * (`Order.query()` vẫn là đường legacy thuần postmeta — dùng method này khi cần
   * an toàn với cả HPOS.)
   */
  static async findOrder(id: number, connection?: WpConnection): Promise<Order | null> {
    const conn = connection ?? getConnection();
    if (await usesHpos(conn)) return loadHposOrder(conn, id);
    return Order.query(conn).where({ ID: id }).withMeta().first();
  }

  /** Đọc 1 đơn từ HPOS (ép kiểu, KHÔNG auto-detect) — cho site HPOS-only hoặc kiểm thử. */
  static findOrderHpos(id: number, connection?: WpConnection): Promise<Order | null> {
    return loadHposOrder(connection ?? getConnection(), id);
  }

  /**
   * Đơn của một khách (mới nhất trước) — tự phát hiện HPOS.
   * HPOS: lọc `wc_orders.customer_id`. Legacy: `hasMeta('_customer_user')`.
   */
  static async forCustomer(customerId: number, connection?: WpConnection): Promise<Order[]> {
    const conn = connection ?? getConnection();
    if (!customerId) return [];
    if (await usesHpos(conn)) {
      const ids = (await conn.sequelize.query(
        `SELECT id FROM ${conn.prefix}wc_orders WHERE customer_id=? AND type='shop_order' ORDER BY date_created_gmt DESC`,
        { replacements: [customerId] },
      ))[0] as Array<{ id: number }>;
      const out: Order[] = [];
      for (const r of ids) {
        const o = await loadHposOrder(conn, Number(r.id));
        if (o) out.push(o);
      }
      return out;
    }
    return Order.query(conn).hasMeta('_customer_user', String(customerId)).withMeta().newest().all();
  }

  // ----- tạo đơn (ghi thẳng DB, auto-detect HPOS) -------------------------

  /**
   * Tạo đơn WooCommerce ghi THẲNG vào DB (không qua REST API).
   *
   * Tự phát hiện kiểu lưu (đọc option HPOS) và ghi đúng nơi:
   *   - legacy: `wp_posts` + `wp_postmeta`
   *   - HPOS:   `wc_orders` + `wc_order_addresses` + `wc_order_operational_data`
   *   - sync bật → ghi cả hai (cùng id)
   * Order items (`woocommerce_order_items`/`_itemmeta`) ghi cho cả hai. Toàn bộ
   * trong 1 transaction (rollback nếu lỗi).
   *
   * ⚠️ KHÔNG chạy hook WooCommerce → KHÔNG gửi email, KHÔNG trừ tồn kho, và
   * bảng Analytics chưa cập nhật cho tới khi WooCommerce regenerate. Thuế/phí
   * ship/coupon = 0 (đơn cơ bản). Dùng REST API nếu cần các thứ đó tự động.
   */
  static async createOrder(input: CreateOrderInput, connection?: WpConnection): Promise<Order> {
    const conn = connection ?? getConnection();
    conn.assertWritable('Order.createOrder');
    if (!input.lines?.length) throw new Error('Order.createOrder: cần ít nhất 1 dòng hàng');

    const seq = conn.sequelize;
    const P = conn.prefix;

    // Đọc option cửa hàng: tiền tệ, số lẻ, version WC, cờ HPOS.
    const optRows = (await seq.query(
      `SELECT option_name, option_value FROM ${P}options WHERE option_name IN ` +
        `('woocommerce_currency','woocommerce_price_num_decimals','woocommerce_version',` +
        `'woocommerce_custom_orders_table_enabled','woocommerce_custom_orders_table_data_sync_enabled')`,
    ))[0] as Array<{ option_name: string; option_value: string }>;
    const opt = new Map(optRows.map((r) => [r.option_name, r.option_value]));
    const currency = input.currency ?? opt.get('woocommerce_currency') ?? 'USD';
    const decimals = parseInt(opt.get('woocommerce_price_num_decimals') ?? '2', 10) || 0;
    const wcVersion = opt.get('woocommerce_version') ?? '';
    const enabled = opt.get('woocommerce_custom_orders_table_enabled');
    const sync = opt.get('woocommerce_custom_orders_table_data_sync_enabled');
    const writeLegacy = enabled !== 'yes' || sync === 'yes';
    const writeHpos = enabled === 'yes' || sync === 'yes';

    // Resolve sản phẩm + tính tiền dòng.
    const items: { productId: number; name: string; qty: number; total: string }[] = [];
    let orderTotalNum = 0;
    for (const l of input.lines) {
      const qty = Math.max(1, Math.floor(l.quantity || 1));
      const p = await Product.query(conn).where({ ID: l.productId }).withMeta().first();
      if (!p) throw new Error(`Order.createOrder: không tìm thấy sản phẩm #${l.productId}`);
      const lineNum = (parseFloat(p.price) || 0) * qty;
      orderTotalNum += lineNum;
      items.push({ productId: l.productId, name: p.title ?? '', qty, total: lineNum.toFixed(decimals) });
    }
    const orderTotal = orderTotalNum.toFixed(decimals);

    const status = (input.status ?? 'processing').replace(/^wc-/, '');
    const wcStatus = `wc-${status}`;
    const paymentMethod = input.paymentMethod ?? 'cod';
    const paymentMethodTitle = input.paymentMethodTitle ?? 'Cash on delivery';
    const customerId = input.customerId ?? 0;
    const createdVia = input.createdVia ?? 'storefront';
    const note = input.customerNote ?? '';
    const ip = input.customerIp ?? '';
    const ua = input.customerUserAgent ?? '';
    const orderKey = generateOrderKey();
    const billing = input.billing ?? {};
    const shipping = input.shipping ?? input.billing ?? {};
    const billingEmail = billing.email ?? '';

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const gmtStr = now.toISOString().slice(0, 19).replace('T', ' ');
    const lastId = async (t: unknown): Promise<number> => {
      const r = (await seq.query('SELECT LAST_INSERT_ID() AS id', { transaction: t as never }))[0] as Array<{ id: number }>;
      return Number(r[0].id);
    };

    let orderId = 0;
    await seq.transaction(async (t) => {
      if (writeLegacy) {
        await seq.query(
          `INSERT INTO ${P}posts (post_author,post_date,post_date_gmt,post_content,post_title,post_excerpt,post_status,comment_status,ping_status,post_password,post_name,to_ping,pinged,post_modified,post_modified_gmt,post_content_filtered,post_parent,guid,menu_order,post_type,post_mime_type,comment_count)
           VALUES (?,?,?,'',?,?,?,'closed','closed','','','','',?,?,'',0,'',0,'shop_order','',0)`,
          { replacements: [customerId, localStr, gmtStr, `Đơn hàng – ${localStr}`, note, wcStatus, localStr, gmtStr], transaction: t },
        );
        orderId = await lastId(t);

        const meta: Record<string, string> = {
          _order_key: orderKey, _customer_user: String(customerId), _order_currency: currency,
          _order_total: orderTotal, _order_tax: '0', _order_shipping: '0', _order_shipping_tax: '0',
          _cart_discount: '0', _cart_discount_tax: '0', _prices_include_tax: 'no',
          _payment_method: paymentMethod, _payment_method_title: paymentMethodTitle,
          _created_via: createdVia, _order_version: wcVersion, _customer_ip_address: ip, _customer_user_agent: ua,
          _order_stock_reduced: 'no', _download_permissions_granted: 'no', _recorded_sales: 'no',
          _recorded_coupon_usage_counts: 'no', _new_order_email_sent: 'no',
        };
        for (const f of ADDR_FIELDS) meta[`_billing_${f}`] = addr(billing, f);
        meta._billing_email = billingEmail;
        meta._billing_phone = billing.phone ?? '';
        for (const f of ADDR_FIELDS) meta[`_shipping_${f}`] = addr(shipping, f);
        meta._shipping_phone = shipping.phone ?? '';
        meta._billing_address_index = [...ADDR_FIELDS.map((f) => addr(billing, f)), billingEmail, billing.phone ?? ''].filter(Boolean).join(' ');
        meta._shipping_address_index = [...ADDR_FIELDS.map((f) => addr(shipping, f)), shipping.phone ?? ''].filter(Boolean).join(' ');

        const e = Object.entries(meta);
        await seq.query(
          `INSERT INTO ${P}postmeta (post_id,meta_key,meta_value) VALUES ${e.map(() => '(?,?,?)').join(',')}`,
          { replacements: e.flatMap(([k, v]) => [orderId, k, v]), transaction: t },
        );
      }

      if (writeHpos) {
        const cols = 'status,currency,type,tax_amount,total_amount,customer_id,billing_email,date_created_gmt,date_updated_gmt,parent_order_id,payment_method,payment_method_title,ip_address,user_agent,customer_note';
        const vals = [wcStatus, currency, 'shop_order', '0', orderTotal, customerId, billingEmail, gmtStr, gmtStr, 0, paymentMethod, paymentMethodTitle, ip, ua, note];
        if (orderId) {
          await seq.query(`INSERT INTO ${P}wc_orders (id,${cols}) VALUES (?,${vals.map(() => '?').join(',')})`, { replacements: [orderId, ...vals], transaction: t });
        } else {
          await seq.query(`INSERT INTO ${P}wc_orders (${cols}) VALUES (${vals.map(() => '?').join(',')})`, { replacements: vals, transaction: t });
          orderId = await lastId(t);
        }
        for (const [type, a] of [['billing', billing], ['shipping', shipping]] as const) {
          await seq.query(
            `INSERT INTO ${P}wc_order_addresses (order_id,address_type,first_name,last_name,company,address_1,address_2,city,state,postcode,country,email,phone)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            { replacements: [orderId, type, addr(a, 'first_name'), addr(a, 'last_name'), addr(a, 'company'), addr(a, 'address_1'), addr(a, 'address_2'), addr(a, 'city'), addr(a, 'state'), addr(a, 'postcode'), addr(a, 'country'), type === 'billing' ? billingEmail : '', a.phone ?? ''], transaction: t },
          );
        }
        await seq.query(
          `INSERT INTO ${P}wc_order_operational_data (order_id,created_via,woocommerce_version,prices_include_tax,coupon_usages_are_counted,download_permission_granted,cart_hash,new_order_email_sent,order_key,order_stock_reduced,shipping_tax_amount,shipping_total_amount,discount_tax_amount,discount_total_amount,recorded_sales)
           VALUES (?,?,?,0,0,0,NULL,0,?,0,0,0,0,0,0)`,
          { replacements: [orderId, createdVia, wcVersion, orderKey], transaction: t },
        );
      }

      for (const it of items) {
        await seq.query(`INSERT INTO ${P}woocommerce_order_items (order_item_name,order_item_type,order_id) VALUES (?,?,?)`, { replacements: [it.name, 'line_item', orderId], transaction: t });
        const itemId = await lastId(t);
        const im: Record<string, string> = {
          _product_id: String(it.productId), _variation_id: '0', _qty: String(it.qty), _tax_class: '',
          _line_subtotal: it.total, _line_subtotal_tax: '0', _line_total: it.total, _line_tax: '0',
          _line_tax_data: 'a:2:{s:5:"total";a:0:{}s:8:"subtotal";a:0:{}}',
        };
        const ie = Object.entries(im);
        await seq.query(`INSERT INTO ${P}woocommerce_order_itemmeta (order_item_id,meta_key,meta_value) VALUES ${ie.map(() => '(?,?,?)').join(',')}`, { replacements: ie.flatMap(([k, v]) => [itemId, k, v]), transaction: t });
      }
    });

    const created = await Order.find(orderId, conn);
    if (!created) throw new Error('Order.createOrder: tạo xong nhưng không đọc lại được');
    return created;
  }
}

// Re-export for star import convenience
export { BillingAddress, ShippingAddress, Payment };
