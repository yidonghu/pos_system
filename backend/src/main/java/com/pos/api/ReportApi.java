package com.pos.api;

import com.pos.util.Csv;
import com.pos.util.Nums;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

@RestController
@RequestMapping("/api")
public class ReportApi {

    private final JdbcTemplate jdbc;

    public ReportApi(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/admin/reports/overview")
    public Map<String, Object> overview(@RequestParam(value = "from", required = false) Long from,
                                        @RequestParam(value = "to", required = false) Long to) {
        long start = from == null ? todayStart() : from;
        long end = to == null ? System.currentTimeMillis() : to;

        Map<String, Object> gross = one(
                "SELECT COUNT(*) AS cnt, COALESCE(SUM(payable),0) AS amt, COALESCE(SUM(total),0) AS total" +
                        " FROM orders WHERE status='paid' AND occur_at BETWEEN ? AND ?", start, end);
        Map<String, Object> refund = one(
                "SELECT COUNT(*) AS cnt, COALESCE(SUM(-payable),0) AS amt" +
                        " FROM orders WHERE status='refund' AND occur_at BETWEEN ? AND ?", start, end);
        Map<String, Object> items = one(
                "SELECT COALESCE(SUM(i.qty),0) AS qty FROM order_item i JOIN orders o ON o.id=i.order_id" +
                        " WHERE o.status='paid' AND o.occur_at BETWEEN ? AND ?", start, end);

        long grossAmt = Nums.l(gross.get("amt"));
        long refundAmt = Nums.l(refund.get("amt"));
        long net = grossAmt - refundAmt;
        long orderCnt = Nums.l(gross.get("cnt"));

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("from", start);
        r.put("to", end);
        r.put("revenue", net);
        r.put("gross", grossAmt);
        r.put("refund", refundAmt);
        r.put("orders", orderCnt);
        r.put("refund_orders", Nums.l(refund.get("cnt")));
        r.put("items", Nums.l(items.get("qty")));
        r.put("avg", orderCnt == 0 ? 0 : net / orderCnt);

        r.put("payments", jdbc.queryForList(
                "SELECT p.method, COALESCE(SUM(p.amount),0) AS amount, COUNT(*) AS cnt FROM payment p" +
                        " JOIN orders o ON o.id=p.order_id WHERE o.occur_at BETWEEN ? AND ?" +
                        " AND o.status IN ('paid','refund') GROUP BY p.method ORDER BY amount DESC", start, end));

        r.put("daily", jdbc.queryForList(
                "SELECT date(occur_at/1000,'unixepoch','localtime') AS day, COALESCE(SUM(payable),0) AS amount, COUNT(*) AS cnt" +
                        " FROM orders WHERE status IN ('paid','refund') AND occur_at BETWEEN ? AND ?" +
                        " GROUP BY day ORDER BY day", start, end));

        r.put("hourly", jdbc.queryForList(
                "SELECT strftime('%H', occur_at/1000,'unixepoch','localtime') AS hour, COALESCE(SUM(payable),0) AS amount" +
                        " FROM orders WHERE status IN ('paid','refund') AND occur_at BETWEEN ? AND ? GROUP BY hour ORDER BY hour",
                start, end));

        r.put("top", jdbc.queryForList(
                "SELECT i.product_name AS name, COALESCE(SUM(i.qty),0) AS qty, COALESCE(SUM(i.amount),0) AS amount" +
                        " FROM order_item i JOIN orders o ON o.id=i.order_id" +
                        " WHERE o.status IN ('paid','refund') AND o.occur_at BETWEEN ? AND ? GROUP BY i.product_name" +
                        " ORDER BY amount DESC LIMIT 10", start, end));

        r.put("devices", jdbc.queryForList(
                "SELECT o.device_name AS name, COUNT(*) AS cnt, COALESCE(SUM(o.payable),0) AS amount" +
                        " FROM orders o WHERE o.status IN ('paid','refund') AND o.occur_at BETWEEN ? AND ?" +
                        " GROUP BY o.device_name ORDER BY amount DESC", start, end));

        r.put("low_stock", jdbc.queryForList(
                "SELECT p.id,p.name,COALESCE(s.qty,0) AS qty,p.stock_alert FROM product p" +
                        " LEFT JOIN stock s ON s.product_id=p.id" +
                        " WHERE p.status=1 AND COALESCE(s.qty,0) <= p.stock_alert ORDER BY qty ASC LIMIT 10"));

        Long stockValue = jdbc.queryForObject(
                "SELECT COALESCE(SUM(COALESCE(s.qty,0)*p.cost_price),0) FROM product p" +
                        " LEFT JOIN stock s ON s.product_id=p.id WHERE p.status=1", Long.class);
        r.put("stock_value", stockValue == null ? 0 : stockValue);
        return r;
    }

    @GetMapping(value = "/admin/reports/export.csv", produces = "text/csv;charset=UTF-8")
    public ResponseEntity<String> export(@RequestParam(value = "type", defaultValue = "sales") String type,
                                         @RequestParam(value = "from", required = false) Long from,
                                         @RequestParam(value = "to", required = false) Long to) {
        long start = from == null ? todayStart() : from;
        long end = to == null ? System.currentTimeMillis() : to;
        String file;
        List<String> headers;
        List<List<String>> rows = new ArrayList<>();

        if ("products".equals(type)) {
            file = "product-sales.csv";
            headers = List.of("商品", "销量", "销售额(元)");
            for (Map<String, Object> m : jdbc.queryForList(
                    "SELECT i.product_name AS name, SUM(i.qty) AS qty, SUM(i.amount) AS amount FROM order_item i" +
                            " JOIN orders o ON o.id=i.order_id WHERE o.status='paid' AND o.occur_at BETWEEN ? AND ?" +
                            " GROUP BY i.product_name ORDER BY amount DESC", start, end)) {
                rows.add(List.of(Nums.s(m.get("name")), Nums.s(m.get("qty")), Nums.fenToYuan(Nums.l(m.get("amount")))));
            }
        } else if ("payments".equals(type)) {
            file = "payments.csv";
            headers = List.of("时间", "订单号", "支付方式", "金额(元)", "设备");
            for (Map<String, Object> m : jdbc.queryForList(
                    "SELECT o.occur_at,o.order_no,o.device_name,p.method,p.amount FROM payment p" +
                            " JOIN orders o ON o.id=p.order_id WHERE o.occur_at BETWEEN ? AND ? ORDER BY o.id DESC",
                    start, end)) {
                rows.add(List.of(fmtTime(Nums.l(m.get("occur_at"))), Nums.s(m.get("order_no")),
                        methodName(Nums.s(m.get("method"))), Nums.fenToYuan(Nums.l(m.get("amount")))));
            }
        } else {
            file = "sales.csv";
            headers = List.of("时间", "订单号", "设备", "原价(元)", "优惠(元)", "抹零(元)", "实收(元)", "状态");
            for (Map<String, Object> m : jdbc.queryForList(
                    "SELECT o.* FROM orders o WHERE o.occur_at BETWEEN ? AND ? ORDER BY o.id DESC", start, end)) {
                rows.add(List.of(fmtTime(Nums.l(m.get("occur_at"))), Nums.s(m.get("order_no")),
                        Nums.s(m.get("device_name")),
                        Nums.fenToYuan(Nums.l(m.get("total"))),
                        Nums.fenToYuan(Nums.l(m.get("discount"))),
                        Nums.fenToYuan(Nums.l(m.get("round_off"))),
                        Nums.fenToYuan(Nums.l(m.get("payable"))),
                        "refund".equals(Nums.s(m.get("status"))) ? "退款" : "正常"));
            }
        }

        String csv = Csv.build(headers, rows);
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"" + file + "\"")
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(csv);
    }

    private Map<String, Object> one(String sql, Object... args) {
        List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    private String methodName(String m) {
        return switch (m) {
            case "cash" -> "现金";
            case "wechat" -> "微信";
            case "alipay" -> "支付宝";
            case "bank" -> "银行卡";
            default -> m;
        };
    }

    private String fmtTime(long millis) {
        return java.time.LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(millis),
                        java.time.ZoneId.systemDefault())
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    private long todayStart() {
        return LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
