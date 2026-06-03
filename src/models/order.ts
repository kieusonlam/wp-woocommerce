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
