package com.pos.api;

import com.pos.service.Settings;
import com.pos.util.ApiError;
import com.pos.util.Nums;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class DeviceApi {

    private final JdbcTemplate jdbc;
    private final Settings settings;

    public DeviceApi(JdbcTemplate jdbc, Settings settings) {
        this.jdbc = jdbc;
        this.settings = settings;
    }

    @PostMapping("/device/register")
    public Map<String, Object> register(@RequestBody Map<String, Object> body) {
        String id = Nums.s(body.get("id")).trim();
        String name = Nums.s(body.get("name")).trim();
        String type = Nums.s(body.get("type"), "pc");
        if (id.length() < 8) throw new ApiError("设备标识无效");
        if (name.isEmpty()) throw new ApiError("设备名不能为空");
        name = name.length() > 20 ? name.substring(0, 20) : name;

        long now = System.currentTimeMillis();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM device WHERE id=?", id);
        if (rows.isEmpty()) {
            jdbc.update("INSERT INTO device(id,name,type,permissions,enabled,bind_code,created_at,last_seen) VALUES(?,?,?,?,1,NULL,?,?)",
                    id, name, type, "{\"can_change_price\":false,\"discount_limit\":10,\"can_return\":true,\"can_stock\":true}", now, now);
            log("device.register", id, name, "新设备接入");
        } else {
            Map<String, Object> row = rows.get(0);
            if (Nums.i(row.get("enabled"), 1) == 0) throw new ApiError("该设备已被停用，请联系管理员");
            jdbc.update("UPDATE device SET name=?, type=?, last_seen=? WHERE id=?", name, type, now, id);
        }
        return Map.of("ok", true, "device", deviceInfo(id));
    }

    @GetMapping("/device/me")
    public Map<String, Object> me(@RequestHeader(value = "X-Device-Id", required = false) String id) {
        if (id == null || id.isEmpty()) throw new ApiError("缺少设备标识");
        return deviceInfo(id);
    }

    @PostMapping("/device/bind")
    public Map<String, Object> bind(@RequestBody Map<String, Object> body) {
        String code = Nums.s(body.get("code")).trim().toUpperCase();
        if (code.isEmpty()) throw new ApiError("请输入设备码");
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM device WHERE bind_code=?", code);
        if (rows.isEmpty()) throw new ApiError("设备码不存在");
        Map<String, Object> row = rows.get(0);
        if (Nums.i(row.get("enabled"), 1) == 0) throw new ApiError("该设备已被停用");
        jdbc.update("UPDATE device SET last_seen=? WHERE id=?", System.currentTimeMillis(), row.get("id"));
        return Map.of("ok", true, "id", row.get("id"), "name", row.get("name"), "type", row.get("type"));
    }

    @GetMapping("/device/config")
    public Map<String, Object> config() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("shop_name", settings.get("shop_name", "我的小店"));
        m.put("shop_address", settings.get("shop_address", ""));
        m.put("shop_phone", settings.get("shop_phone", ""));
        m.put("receipt_footer", settings.get("receipt_footer", ""));
        m.put("paper_width", settings.get("paper_width", "80"));
        m.put("auto_print", settings.get("auto_print", "0"));
        m.put("allow_negative", settings.get("allow_negative", "0"));
        m.put("lan_url", com.pos.util.Net.lanUrl());
        m.put("lan_url_secure", com.pos.util.Net.lanSecureUrl());
        return m;
    }

    private Map<String, Object> deviceInfo(String id) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id,name,type,permissions,enabled,last_seen FROM device WHERE id=?", id);
        if (rows.isEmpty()) throw new ApiError("设备未注册");
        Map<String, Object> row = rows.get(0);
        if (Nums.i(row.get("enabled"), 1) == 0) throw new ApiError("该设备已被停用");
        jdbc.update("UPDATE device SET last_seen=? WHERE id=?", System.currentTimeMillis(), id);
        Map<String, Object> m = new LinkedHashMap<>(row);
        m.put("ok", true);
        return m;
    }

    private void log(String action, String deviceId, String deviceName, String detail) {
        jdbc.update("INSERT INTO op_log(device_id,device_name,action,detail,occur_at) VALUES(?,?,?,?,?)",
                deviceId, deviceName, action, detail, System.currentTimeMillis());
    }
}
