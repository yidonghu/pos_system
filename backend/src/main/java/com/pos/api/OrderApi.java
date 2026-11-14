package com.pos.api;

import com.pos.service.CheckoutService;
import com.pos.util.ApiError;
import com.pos.util.Nums;
import com.pos.util.Tokens;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

@RestController
@RequestMapping("/api/orders")
public class OrderApi {

    private final JdbcTemplate jdbc;
    private final CheckoutService checkoutService;
    private final Tokens tokens;
    private final ObjectMapper om = new ObjectMapper();

    public OrderApi(JdbcTemplate jdbc, CheckoutService checkoutService, Tokens tokens) {
        this.jdbc = jdbc;
        this.checkoutService = checkoutService;
        this.tokens = tokens;
    }

    @PostMapping("/checkout")
    public Map<String, Object> checkout(@RequestBody Map<String, Object> body,
                                        @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        Map<String, Object> device = requireDevice(deviceId);
        return checkoutService.checkout(body, deviceId, Nums.s(device.get("name")),
                permissions(device));
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(value = "from", required = false) Long from,
            @RequestParam(value = "to", required = false) Long to,
            @RequestParam(value = "device", required = false) String deviceId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "kw", required = false) String kw,
            @RequestParam(value = "limit", required = false, defaultValue = "100") int limit) {

        long start = from == null ? todayStart() : from;
        long end = to == null ? System.currentTimeMillis() : to;

        StringBuilder sql = new StringBuilder(
                "SELECT o.id,o.order_no,o.device_id,o.device_name,o.total,o.discount,o.round_off,o.payable,o.status," +
                        " o.refund_of,o.remark,o.occur_at," +
                        " (SELECT group_concat(p.method||':'||p.amount,'|') FROM payment p WHERE p.order_id=o.id) AS pays," +
                        " (SELECT COUNT(*) FROM order_item i WHERE i.order_id=o.id) AS item_count" +
                        " FROM orders o WHERE o.occur_at BETWEEN ? AND ? ");
        List<Object> args = new ArrayList<>(List.of(start, end));
        if (deviceId != null && !deviceId.isBlank()) {
            sql.append(" AND o.device_id=? ");
            args.add(deviceId);
        }
        if (status != null && !status.isBlank()) {
            sql.append(" AND o.status=? ");
            args.add(status);
        }
        if (kw != null && !kw.isBlank()) {
            sql.append(" AND o.order_no LIKE ? ");
            args.add("%" + kw.trim() + "%");
        }
        sql.append(" ORDER BY o.id DESC LIMIT ?");
        args.add(Math.min(limit, 500));
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM orders WHERE id=?", id);
        if (rows.isEmpty()) throw new ApiError("订单不存在");
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("order", rows.get(0));
        r.put("items", jdbc.queryForList("SELECT * FROM order_item WHERE order_id=? ORDER BY id", id));
        r.put("payments", jdbc.queryForList("SELECT * FROM payment WHERE order_id=? ORDER BY id", id));
        List<Map<String, Object>> refunds = jdbc.queryForList(
                "SELECT id,order_no,payable,occur_at FROM orders WHERE refund_of=?", id);
        r.put("refunds", refunds);
        return r;
    }

    @PostMapping("/{id}/return")
    public Map<String, Object> refund(@PathVariable long id, @RequestBody(required = false) Map<String, Object> body,
                                      @RequestHeader(value = "X-Device-Id", required = false) String deviceId,
                                      @RequestHeader(value = "X-Admin-Token", required = false) String adminToken) {
        String reason = body == null ? "" : Nums.s(body.get("reason"));

        if (deviceId == null || deviceId.isBlank()) {
            if (!tokens.valid(adminToken)) throw new ApiError("未授权操作");
            return checkoutService.refund(id, "admin", "管理后台", reason);
        }

        Map<String, Object> device = requireDevice(deviceId);
        if (Boolean.FALSE.equals(permissions(device).get("can_return"))) {
            throw new ApiError("当前设备无退货权限");
        }
        return checkoutService.refund(id, deviceId, Nums.s(device.get("name")), reason);
    }

    // ---------- 挂单 ----------

    @PostMapping("/hold")
    public Map<String, Object> hold(@RequestBody Map<String, Object> body,
                                    @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        requireDevice(deviceId);
        try {
            String payload = om.writeValueAsString(body.get("payload"));
            jdbc.update("INSERT INTO held(device_id,payload,note,created_at) VALUES(?,?,?,?)",
                    deviceId, payload, Nums.s(body.get("note")), System.currentTimeMillis());
            long id = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
            return Map.of("ok", true, "id", id);
        } catch (Exception e) {
            throw new ApiError("挂单失败: " + e.getMessage());
        }
    }

    @GetMapping("/held")
    public List<Map<String, Object>> held(@RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        requireDevice(deviceId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,payload,note,created_at FROM held WHERE device_id=? ORDER BY id DESC", deviceId);
        for (Map<String, Object> row : rows) {
            String payload = Nums.s(row.get("payload"));
            try {
                row.put("data", om.readValue(payload, Map.class));
                row.put("summary", "挂单");
            } catch (Exception ignored) {
            }
        }
        return rows;
    }

    @DeleteMapping("/held/{id}")
    public Map<String, Object> dropHeld(@PathVariable long id,
                                        @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        requireDevice(deviceId);
        jdbc.update("DELETE FROM held WHERE id=? AND device_id=?", id, deviceId);
        return Map.of("ok", true);
    }

    // ---------- 内部 ----------

    private Map<String, Object> requireDevice(String deviceId) {
        if (deviceId == null || deviceId.isBlank()) throw new ApiError("缺少设备标识");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM device WHERE id=?", deviceId);
        if (rows.isEmpty()) throw new ApiError("设备未注册，请先完成设备初始化");
        Map<String, Object> d = rows.get(0);
        if (Nums.i(d.get("enabled"), 1) == 0) throw new ApiError("该设备已被停用");
        return d;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> permissions(Map<String, Object> device) {
        try {
            return om.readValue(Nums.s(device.get("permissions"), "{}"), Map.class);
        } catch (Exception e) {
            return Map.of();
        }
    }

    private long todayStart() {
        return LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
}
