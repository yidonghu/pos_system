package com.pos.api;

import com.pos.util.ApiError;
import com.pos.util.Nums;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class ShiftApi {

    private final JdbcTemplate jdbc;

    public ShiftApi(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostMapping("/shifts/start")
    public Map<String, Object> start(@RequestBody(required = false) Map<String, Object> body,
                                     @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        requireDevice(deviceId);
        List<Map<String, Object>> open = jdbc.queryForList(
                "SELECT id FROM shift WHERE device_id=? AND status='open'", deviceId);
        if (!open.isEmpty()) throw new ApiError("该设备已有未结束的班次，请先交班");

        long cash = body == null ? 0 : Nums.l(body.get("opening_cash"));
        if (cash < 0) throw new ApiError("备用金不能为负");
        long now = System.currentTimeMillis();
        jdbc.update("INSERT INTO shift(device_id,start_at,opening_cash,status) VALUES(?,?,?,'open')",
                deviceId, now, cash);
        long id = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
        return Map.of("ok", true, "shift_id", id, "start_at", now);
    }

    @GetMapping("/shifts/current")
    public Map<String, Object> current(@RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        requireDevice(deviceId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM shift WHERE device_id=? AND status='open' ORDER BY id DESC LIMIT 1", deviceId);
        if (rows.isEmpty()) return Map.of("open", false);
        Map<String, Object> s = new LinkedHashMap<>(rows.get(0));
        long cashIn = cashIn(Nums.l(s.get("id")));
        s.put("open", true);
        s.put("cash_in", cashIn);
        s.put("cash_expected", Nums.l(s.get("opening_cash")) + cashIn);
        s.put("orders", jdbc.queryForObject(
                "SELECT COUNT(*) FROM orders WHERE shift_id=? AND status='paid'", Integer.class, s.get("id")));
        return s;
    }

    @PostMapping("/shifts/end")
    public Map<String, Object> end(@RequestBody Map<String, Object> body,
                                   @RequestHeader(value = "X-Device-Id", required = false) String deviceId) {
        requireDevice(deviceId);
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT * FROM shift WHERE device_id=? AND status='open' ORDER BY id DESC LIMIT 1", deviceId);
        if (rows.isEmpty()) throw new ApiError("当前没有进行中的班次");
        Map<String, Object> s = rows.get(0);

        long actual = Nums.l(body.get("cash_actual"));
        long expected = Nums.l(s.get("opening_cash")) + cashIn(Nums.l(s.get("id")));
        long now = System.currentTimeMillis();
        jdbc.update("UPDATE shift SET end_at=?, cash_expected=?, cash_actual=?, diff=?, status='closed' WHERE id=?",
                now, expected, actual, actual - expected, s.get("id"));

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("cash_expected", expected);
        r.put("cash_actual", actual);
        r.put("diff", actual - expected);
        return r;
    }

    @GetMapping("/admin/shifts")
    public List<Map<String, Object>> shifts(@RequestParam(value = "limit", required = false, defaultValue = "100") int limit) {
        return jdbc.queryForList(
                "SELECT s.*,(SELECT name FROM device d WHERE d.id=s.device_id) AS device_name" +
                        " FROM shift s ORDER BY s.id DESC LIMIT ?", Math.min(limit, 300));
    }

    private long cashIn(long shiftId) {
        Long v = jdbc.queryForObject(
                "SELECT COALESCE(SUM(p.amount),0) FROM payment p JOIN orders o ON o.id=p.order_id" +
                        " WHERE o.shift_id=? AND p.method='cash' AND o.status IN ('paid','refund')", Long.class, shiftId);
        return v == null ? 0 : v;
    }

    private void requireDevice(String deviceId) {
        if (deviceId == null || deviceId.isBlank()) throw new ApiError("缺少设备标识");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT enabled FROM device WHERE id=?", deviceId);
        if (rows.isEmpty()) throw new ApiError("设备未注册");
        if (Nums.i(rows.get(0).get("enabled"), 1) == 0) throw new ApiError("设备已停用");
    }
}
