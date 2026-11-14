package com.pos.api;

import com.pos.service.Settings;
import com.pos.util.ApiError;
import com.pos.util.Nums;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class InventoryApi {

    private final JdbcTemplate jdbc;
    private final Settings settings;

    public InventoryApi(JdbcTemplate jdbc, Settings settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    @GetMapping("/inventory")
    public List<Map<String, Object>> list(@RequestParam(value = "kw", required = false) String kw,
                                          @RequestParam(value = "onlyAlert", required = false, defaultValue = "0") int onlyAlert) {
        StringBuilder sql = new StringBuilder(
                "SELECT p.id,p.name,p.unit,p.cost_price,p.sale_price,p.stock_alert,p.status," +
                        " COALESCE(s.qty,0) AS qty,(SELECT c.name FROM category c WHERE c.id=p.category_id) AS category_name" +
                        " FROM product p LEFT JOIN stock s ON s.product_id=p.id WHERE p.status=1 ");
        List<Object> args = new ArrayList<>();
        if (kw != null && !kw.isBlank()) {
            sql.append(" AND p.name LIKE ? ");
            args.add("%" + kw.trim() + "%");
        }
        if (onlyAlert == 1) {
            sql.append(" AND COALESCE(s.qty,0) <= p.stock_alert ");
        }
        sql.append(" ORDER BY COALESCE(s.qty,0)-p.stock_alert ASC, p.id DESC LIMIT 500");
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    @GetMapping("/inventory/alerts")
    public Map<String, Object> alerts() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT p.id,p.name,COALESCE(s.qty,0) AS qty,p.stock_alert FROM product p" +
                        " LEFT JOIN stock s ON s.product_id=p.id" +
                        " WHERE p.status=1 AND COALESCE(s.qty,0) <= p.stock_alert ORDER BY qty ASC LIMIT 20");
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("count", rows.size());
        r.put("list", rows);
        return r;
    }

    @PostMapping("/inventory/move")
    public Map<String, Object> move(@RequestBody Map<String, Object> body,
                                   @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        long pid = Nums.l(body.get("product_id"));
        String type = Nums.s(body.get("type"), "in");
        long qty = Nums.l(body.get("qty"));
        if (pid <= 0) throw new ApiError("请选择商品");
        if (qty == 0) throw new ApiError("数量不能为 0");
        if (!Set.of("in", "out", "scrap", "adjust").contains(type)) throw new ApiError("不支持的库存操作类型");

        List<Map<String, Object>> rows = jdbc.queryForList("SELECT name FROM product WHERE id=?", pid);
        if (rows.isEmpty()) throw new ApiError("商品不存在");

        long delta;
        switch (type) {
            case "in" -> delta = Math.abs(qty);
            case "out", "scrap" -> delta = -Math.abs(qty);
            default -> delta = qty;
        }

        long now = System.currentTimeMillis();
        long current = currentStock(pid);
        long next = current + delta;
        if (next < 0 && !settings.flag("allow_negative")) throw new ApiError("库存不足，当前 " + current);

        jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,unit_cost,ref_no,note,device_id,occur_at)" +
                        " VALUES(?,?,?,?,?,?,?,?)",
                pid, type, delta, body.get("unit_cost") == null ? null : Nums.l(body.get("unit_cost")),
                "MANUAL", Nums.s(body.get("note")), deviceId == null ? "admin" : deviceId, now);
        setStock(pid, next, now);

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("qty", next);
        r.put("name", rows.get(0).get("name"));
        return r;
    }

    @PostMapping("/inventory/stocktake")
    public Map<String, Object> stocktake(@RequestBody Map<String, Object> body,
                                         @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        Object itemsObj = body.get("items");
        if (!(itemsObj instanceof List<?> items) || items.isEmpty()) throw new ApiError("盘点项为空");
        long now = System.currentTimeMillis();
        String ref = "CHECK-" + now;
        int changed = 0;
        for (Object o : items) {
            Map<String, Object> item = Nums.map(o);
            long pid = Nums.l(item.get("product_id"));
            long real = Nums.l(item.get("real_qty"));
            if (pid <= 0) continue;
            long current = currentStock(pid);
            long diff = real - current;
            if (diff == 0) continue;
            jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,ref_no,note,device_id,occur_at)" +
                            " VALUES(?, 'check', ?, ?, '盘点调整', ?, ?)",
                    pid, diff, ref, deviceId == null ? "admin" : deviceId, now);
            setStock(pid, real, now);
            changed++;
        }
        return Map.of("ok", true, "changed", changed, "ref", ref);
    }

    @GetMapping("/inventory/movements")
    public List<Map<String, Object>> movements(@RequestParam(value = "product_id", required = false) Long pid,
                                               @RequestParam(value = "limit", required = false, defaultValue = "100") int limit) {
        StringBuilder sql = new StringBuilder(
                "SELECT m.id,m.type,m.qty,m.unit_cost,m.ref_no,m.note,m.device_id,m.occur_at,p.name,p.unit" +
                        " FROM inventory_movement m JOIN product p ON p.id=m.product_id WHERE 1=1 ");
        List<Object> args = new ArrayList<>();
        if (pid != null) {
            sql.append(" AND m.product_id=? ");
            args.add(pid);
        }
        sql.append(" ORDER BY m.id DESC LIMIT ?");
        args.add(Math.min(limit, 500));
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    private long currentStock(long pid) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT qty FROM stock WHERE product_id=?", pid);
        return rows.isEmpty() ? 0L : Nums.l(rows.get(0).get("qty"));
    }

    private void setStock(long pid, long qty, long now) {
        jdbc.update("INSERT INTO stock(product_id,qty,updated_at) VALUES(?,?,?)" +
                " ON CONFLICT(product_id) DO UPDATE SET qty=excluded.qty, updated_at=excluded.updated_at", pid, qty, now);
    }
}
