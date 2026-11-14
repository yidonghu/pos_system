package com.pos.service;

import com.pos.util.ApiError;
import com.pos.util.Nums;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class CheckoutService {

    private final JdbcTemplate jdbc;
    private final Settings settings;

    public CheckoutService(JdbcTemplate jdbc, Settings settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    private static final Set<String> METHODS = Set.of("cash", "wechat", "alipay", "bank");

    @Transactional
    public Map<String, Object> checkout(Map<String, Object> body, String deviceId, String deviceName,
                                        Map<String, Object> perms) {
        long now = System.currentTimeMillis();
        boolean allowNegative = settings.flag("allow_negative");
        boolean canChangePrice = Boolean.TRUE.equals(perms.get("can_change_price"));
        int discountLimit = perms.get("discount_limit") == null ? 10 : Nums.i(perms.get("discount_limit"), 10);

        Object itemsObj = body.get("items");
        if (!(itemsObj instanceof List<?> items) || items.isEmpty()) throw new ApiError("购物车为空，无法结算");

        long total = 0;
        List<Map<String, Object>> lines = new ArrayList<>();

        for (Object o : items) {
            Map<String, Object> it = Nums.map(o);
            long pid = Nums.l(it.get("product_id"));
            long qty = Nums.l(it.get("qty"), 0);
            if (pid <= 0) throw new ApiError("商品参数错误");
            if (qty <= 0) throw new ApiError("商品数量必须大于 0");

            List<Map<String, Object>> ps = jdbc.queryForList(
                    "SELECT id,name,sale_price,unit,status FROM product WHERE id=?", pid);
            if (ps.isEmpty()) throw new ApiError("商品不存在或已下架");
            Map<String, Object> p = ps.get(0);
            if (Nums.i(p.get("status"), 0) != 1) throw new ApiError(p.get("name") + " 已下架");

            long originPrice = Nums.l(p.get("sale_price"));
            long price = it.get("price") == null ? originPrice : Nums.l(it.get("price"));
            if (price < 0) throw new ApiError("单价不能为负");
            if (price != originPrice && !canChangePrice) {
                throw new ApiError("当前设备无改价权限：" + p.get("name"));
            }

            List<Map<String, Object>> stockRows = jdbc.queryForList(
                    "SELECT qty FROM stock WHERE product_id=?", pid);
            long stock = stockRows.isEmpty() ? 0 : Nums.l(stockRows.get(0).get("qty"));
            if (!allowNegative && stock < qty) {
                throw new ApiError("库存不足：" + p.get("name") + "（剩余 " + stock + "）");
            }

            long amount = price * qty;
            total += amount;

            Map<String, Object> line = new LinkedHashMap<>();
            line.put("product_id", pid);
            line.put("name", p.get("name"));
            line.put("barcode", Nums.s(it.get("barcode")));
            line.put("qty", qty);
            line.put("price", price);
            line.put("amount", amount);
            line.put("stock_after", stock - qty);
            lines.add(line);
        }

        long discount = Nums.l(body.get("discount"), 0);
        long roundOff = Nums.l(body.get("round_off"), 0);
        if (discount < 0 || roundOff < 0) throw new ApiError("优惠金额不能为负");
        if (discount > total) throw new ApiError("优惠金额不能超过订单总额");
        if (discountLimit > 0 && discount > total * discountLimit / 100) {
            throw new ApiError("折扣超出当前设备上限（" + discountLimit + "%）");
        }

        long payable = total - discount - roundOff;
        if (payable < 0) payable = 0;

        Object payObj = body.get("payments");
        long paid = 0;
        List<Map<String, Object>> payments = new ArrayList<>();
        if (payObj instanceof List<?> list) {
            for (Object o : list) {
                Map<String, Object> pm = Nums.map(o);
                String method = Nums.s(pm.get("method"));
                long amount = Nums.l(pm.get("amount"));
                if (!METHODS.contains(method)) throw new ApiError("不支持的支付方式：" + method);
                if (amount < 0) throw new ApiError("支付金额不能为负");
                paid += amount;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("method", method);
                m.put("amount", amount);
                m.put("trade_no", Nums.s(pm.get("trade_no")));
                payments.add(m);
            }
        }
        if (payments.isEmpty()) throw new ApiError("请选择支付方式");
        if (paid != payable) throw new ApiError("支付金额合计 " + Nums.fenToYuan(paid) + " 元，应收 " + Nums.fenToYuan(payable) + " 元");

        String orderNo = nextOrderNo();
        Long shiftId = currentShift(deviceId);

        jdbc.update("INSERT INTO orders(order_no,device_id,device_name,total,discount,round_off,payable,status,shift_id,remark,refund_of,occur_at)" +
                        " VALUES(?,?,?,?,?,?,?,'paid',?,?,NULL,?)",
                orderNo, deviceId, deviceName, total, discount, roundOff, payable, shiftId, Nums.s(body.get("remark")), now);
        long orderId = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);

        for (Map<String, Object> line : lines) {
            jdbc.update("INSERT INTO order_item(order_id,product_id,barcode,product_name,qty,price,amount)" +
                            " VALUES(?,?,?,?,?,?,?)",
                    orderId, line.get("product_id"), line.get("barcode"), line.get("name"),
                    line.get("qty"), line.get("price"), line.get("amount"));
            jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,ref_no,note,device_id,occur_at)" +
                            " VALUES(?, 'sale', ?, ?, '收银出库', ?, ?)",
                    line.get("product_id"), -Nums.l(line.get("qty")), orderNo, deviceId, now);
            setStock(Nums.l(line.get("product_id")), Nums.l(line.get("stock_after")), now);
        }

        for (Map<String, Object> pm : payments) {
            jdbc.update("INSERT INTO payment(order_id,method,amount,trade_no) VALUES(?,?,?,?)",
                    orderId, pm.get("method"), pm.get("amount"), pm.get("trade_no"));
        }

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("id", orderId);
        r.put("order_no", orderNo);
        r.put("total", total);
        r.put("discount", discount);
        r.put("round_off", roundOff);
        r.put("payable", payable);
        r.put("items", lines);
        r.put("payments", payments);
        r.put("device_name", deviceName);
        r.put("occur_at", now);
        return r;
    }

    @Transactional
    public Map<String, Object> refund(long orderId, String deviceId, String deviceName, String reason) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM orders WHERE id=? AND status='paid'", orderId);
        if (rows.isEmpty()) throw new ApiError("订单不存在或已退款");
        Map<String, Object> o = rows.get(0);

        List<Map<String, Object>> existed = jdbc.queryForList("SELECT id FROM orders WHERE refund_of=?", orderId);
        if (!existed.isEmpty()) throw new ApiError("该订单已退款");

        String orderNo = Nums.s(o.get("order_no")) + "-R";
        long now = System.currentTimeMillis();
        long total = -Nums.l(o.get("total"));
        long discount = -Nums.l(o.get("discount"));
        long roundOff = -Nums.l(o.get("round_off"));
        long payable = -Nums.l(o.get("payable"));

        Long shiftId = currentShift(deviceId);

        jdbc.update("INSERT INTO orders(order_no,device_id,device_name,total,discount,round_off,payable,status,shift_id,remark,refund_of,occur_at)" +
                        " VALUES(?,?,?,?,?,?,?,'refund',?,?,?,?)",
                orderNo, deviceId, deviceName, total, discount, roundOff, payable, shiftId,
                "退款: " + (reason == null ? "" : reason), orderId, now);
        long refundId = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);

        List<Map<String, Object>> items = jdbc.queryForList(
                "SELECT product_id,barcode,product_name,qty,price,amount FROM order_item WHERE order_id=?", orderId);
        for (Map<String, Object> item : items) {
            long qty = Nums.l(item.get("qty"));
            jdbc.update("INSERT INTO order_item(order_id,product_id,barcode,product_name,qty,price,amount)" +
                            " VALUES(?,?,?,?,?,?,?)",
                    refundId, item.get("product_id"), item.get("barcode"), item.get("product_name"),
                    -qty, item.get("price"), -Nums.l(item.get("amount")));
            jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,ref_no,note,device_id,occur_at)" +
                            " VALUES(?, 'return', ?, ?, '退货入库', ?, ?)",
                    item.get("product_id"), qty, orderNo, deviceId, now);
            long pid = Nums.l(item.get("product_id"));
            setStock(pid, currentStock(pid) + qty, now);
        }

        List<Map<String, Object>> payments = jdbc.queryForList(
                "SELECT method,amount,trade_no FROM payment WHERE order_id=?", orderId);
        for (Map<String, Object> pm : payments) {
            jdbc.update("INSERT INTO payment(order_id,method,amount,trade_no) VALUES(?,?,?,?)",
                    refundId, pm.get("method"), -Nums.l(pm.get("amount")), pm.get("trade_no"));
        }

        jdbc.update("INSERT INTO op_log(device_id,device_name,action,detail,occur_at) VALUES(?,?,?,?,?)",
                deviceId, deviceName, "order.refund", "退款订单 " + o.get("order_no") + " 原因: " + (reason == null ? "" : reason), now);

        return Map.of("ok", true, "refund_order_no", orderNo, "refund_id", refundId);
    }

    private void setStock(long pid, long qty, long now) {
        jdbc.update("INSERT INTO stock(product_id,qty,updated_at) VALUES(?,?,?)" +
                " ON CONFLICT(product_id) DO UPDATE SET qty=excluded.qty, updated_at=excluded.updated_at", pid, qty, now);
    }

    private long currentStock(long pid) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT qty FROM stock WHERE product_id=?", pid);
        return rows.isEmpty() ? 0 : Nums.l(rows.get(0).get("qty"));
    }

    private Long currentShift(String deviceId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id FROM shift WHERE device_id=? AND status='open' ORDER BY id DESC LIMIT 1", deviceId);
        return rows.isEmpty() ? null : Nums.l(rows.get(0).get("id"));
    }

    private String nextOrderNo() {
        String day = LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
        String key = "order:" + day;
        jdbc.update("INSERT OR IGNORE INTO seq(name,val) VALUES(?,0)", key);
        jdbc.update("UPDATE seq SET val=val+1 WHERE name=?", key);
        int v = jdbc.queryForObject("SELECT val FROM seq WHERE name=?", Integer.class, key);
        return day + "-" + String.format("%03d", v);
    }
}
