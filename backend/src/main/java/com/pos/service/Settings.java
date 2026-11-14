package com.pos.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class Settings {

    private final JdbcTemplate jdbc;

    public Settings(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public String get(String key, String def) {
        try {
            String v = jdbc.queryForObject("SELECT v FROM settings WHERE k=?", String.class, key);
            return v == null ? def : v;
        } catch (Exception e) {
            return def;
        }
    }

    public boolean flag(String key) {
        return "1".equals(get(key, "0"));
    }

    public void put(String key, String value) {
        jdbc.update("INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                key, value == null ? "" : value);
    }

    public Map<String, String> all() {
        Map<String, String> m = new LinkedHashMap<>();
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT k,v FROM settings ORDER BY k");
        for (Map<String, Object> r : rows) {
            m.put(String.valueOf(r.get("k")), String.valueOf(r.get("v")));
        }
        return m;
    }
}
