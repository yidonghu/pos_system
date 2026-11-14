package com.pos.api;

import com.pos.service.Settings;
import com.pos.util.ApiError;
import com.pos.util.Nums;
import com.pos.util.Sha;
import com.pos.util.Tokens;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/admin")
public class AdminApi {

    private final JdbcTemplate jdbc;
    private final Settings settings;
    private final Tokens tokens;

    public AdminApi(JdbcTemplate jdbc, Settings settings, Tokens tokens) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.tokens = tokens;
    }

    // ---------- 登录 ----------

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body) {
        String password = Nums.s(body.get("password"));
        if (password.isEmpty()) throw new ApiError("请输入密码");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT password_hash FROM admin WHERE id=1");
        if (rows.isEmpty()) throw new ApiError("管理员未初始化");
        String hash = Nums.s(rows.get(0).get("password_hash"));
        if (!Sha.matches(password, hash)) throw new ApiError("密码错误");
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("token", tokens.issue());
        return r;
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestHeader(value = "X-Admin-Token", required = false) String token) {
        tokens.revoke(token);
        return Map.of("ok", true);
    }

    @PostMapping("/password")
    public Map<String, Object> changePassword(@RequestBody Map<String, Object> body) {
        String oldPwd = Nums.s(body.get("old"));
        String newPwd = Nums.s(body.get("new"));
        if (newPwd.length() < 6) throw new ApiError("新密码至少 6 位");
        String hash = Nums.s(jdbc.queryForList("SELECT password_hash FROM admin WHERE id=1").get(0).get("password_hash"));
        if (!Sha.matches(oldPwd, hash)) throw new ApiError("原密码不正确");
        jdbc.update("UPDATE admin SET password_hash=?, updated_at=? WHERE id=1", Sha.hash(newPwd), System.currentTimeMillis());
        return Map.of("ok", true, "msg", "密码已更新");
    }

    // ---------- 设置 ----------

    @GetMapping("/settings")
    public Map<String, Object> getSettings() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("data", settings.all());
        r.put("lan_url", com.pos.util.Net.lanUrl());
        r.put("lan_url_secure", com.pos.util.Net.lanSecureUrl());
        return r;
    }

    @PutMapping("/settings")
    public Map<String, Object> saveSettings(@RequestBody Map<String, Object> body) {
        Set<String> allowed = Set.of("shop_name", "shop_address", "shop_phone", "receipt_footer",
                "paper_width", "allow_negative", "auto_print");
        for (String k : allowed) {
            if (body.containsKey(k)) settings.put(k, Nums.s(body.get(k)));
        }
        return Map.of("ok", true, "msg", "已保存");
    }

    // ---------- 设备 ----------

    @GetMapping("/devices")
    public List<Map<String, Object>> devices() {
        long from = LocalDateTime.now().toLocalDate().atStartOfDay()
                .atZone(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,name,type,permissions,enabled,bind_code,created_at,last_seen FROM device ORDER BY created_at");
        for (Map<String, Object> row : rows) {
            row.put("today_orders", jdbc.queryForObject(
                    "SELECT COUNT(*) FROM orders WHERE device_id=? AND occur_at>=? AND status='paid'",
                    Integer.class, row.get("id"), from));
        }
        return rows;
    }

    @PutMapping("/devices/{id}")
    public Map<String, Object> updateDevice(@PathVariable String id, @RequestBody Map<String, Object> body) {
        Map<String, Object> row = findDevice(id);
        String name = body.containsKey("name") ? Nums.s(body.get("name")).trim() : Nums.s(row.get("name"));
        if (name.isEmpty()) throw new ApiError("设备名不能为空");
        int enabled = body.containsKey("enabled") ? Nums.i(body.get("enabled"), 1) : Nums.i(row.get("enabled"), 1);
        String perms = body.containsKey("permissions") ? toJson(body.get("permissions")) : Nums.s(row.get("permissions"));
        jdbc.update("UPDATE device SET name=?, permissions=?, enabled=? WHERE id=?", name, perms, enabled, id);
        return Map.of("ok", true);
    }

    @PostMapping("/devices/{id}/code")
    public Map<String, Object> genCode(@PathVariable String id) {
        findDevice(id);
        String code;
        Random rnd = new Random();
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        int guard = 0;
        do {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) sb.append(chars.charAt(rnd.nextInt(chars.length())));
            code = sb.toString();
            guard++;
        } while (guard < 50 && !jdbc.queryForList("SELECT id FROM device WHERE bind_code=?", code).isEmpty());
        jdbc.update("UPDATE device SET bind_code=? WHERE id=?", code, id);
        return Map.of("ok", true, "code", code);
    }

    @DeleteMapping("/devices/{id}")
    public Map<String, Object> deleteDevice(@PathVariable String id) {
        jdbc.update("DELETE FROM device WHERE id=?", id);
        return Map.of("ok", true);
    }

    private Map<String, Object> findDevice(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM device WHERE id=?", id);
        if (rows.isEmpty()) throw new ApiError("设备不存在");
        return rows.get(0);
    }

    // ---------- 数据备份 / 恢复 ----------

    @GetMapping("/backup")
    public ResponseEntity<byte[]> backup() throws Exception {
        Path dir = Path.of("backup");
        Files.createDirectories(dir);
        String name = "pos-" + DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").format(LocalDateTime.now()) + ".db";
        Path out = dir.resolve(name).toAbsolutePath();
        String target = out.toString().replace("\\", "/").replace("'", "''");
        jdbc.execute("VACUUM INTO '" + target + "'");
        byte[] bytes = Files.readAllBytes(out);
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"" + name + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(bytes);
    }

    @PostMapping(value = "/restore", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public Map<String, Object> restore(@RequestBody byte[] bytes) throws Exception {
        if (bytes == null || bytes.length < 100) throw new ApiError("文件为空或损坏");
        byte[] head = Arrays.copyOf(bytes, Math.min(16, bytes.length));
        String magic = new String(head, java.nio.charset.StandardCharsets.US_ASCII);
        if (!magic.startsWith("SQLite format 3")) throw new ApiError("不是有效的 SQLite 数据库文件");
        Files.createDirectories(Path.of("data"));
        Files.write(Path.of("data/pos.db.pending"), bytes);
        return Map.of("ok", true, "msg", "备份已校验并暂存，重启服务后生效");
    }

    // ---------- 演示数据 ----------

    @PostMapping("/demo/clear")
    public Map<String, Object> clearDemo() {
        List<Long> ids = jdbc.queryForList(
                "SELECT id FROM product WHERE demo=1", Long.class);
        for (Long pid : ids) {
            jdbc.update("DELETE FROM product_barcode WHERE product_id=?", pid);
            jdbc.update("DELETE FROM stock WHERE product_id=?", pid);
            jdbc.update("DELETE FROM inventory_movement WHERE product_id=?", pid);
            jdbc.update("DELETE FROM product WHERE id=?", pid);
        }
        return Map.of("ok", true, "msg", "已清除 " + ids.size() + " 个演示商品");
    }

    private String toJson(Object o) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(o);
        } catch (Exception e) {
            return "{}";
        }
    }
}
