package com.pos.api;

import com.pos.util.ApiError;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/** 系统维护：数据概览、一键初始化（清空所有业务数据，自动先备份） */
@RestController
@RequestMapping("/api/admin/system")
public class SystemApi {

    private final JdbcTemplate jdbc;

    public SystemApi(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String[][] COUNTS = {
            {"product", "商品"},
            {"category", "分类"},
            {"orders", "订单"},
            {"device", "设备"},
            {"inventory_movement", "库存流水"},
            {"held", "挂单"},
            {"shift", "交接班"},
    };

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        Map<String, Object> m = new LinkedHashMap<>();
        for (String[] c : COUNTS) {
            try {
                m.put(c[0], jdbc.queryForObject("SELECT COUNT(*) FROM " + c[0], Long.class));
            } catch (Exception e) {
                m.put(c[0], 0L);
            }
        }
        m.put("db_size", dbSize());
        return m;
    }

    private long dbSize() {
        try {
            Path db = Path.of("data/pos.db");
            return Files.exists(db) ? Files.size(db) : 0L;
        } catch (IOException e) {
            return 0L;
        }
    }

    /**
     * 一键初始化：清空商品/分类/订单/支付/库存流水/挂单/交接班/设备，设置回到出厂默认，保留管理员密码。
     * 清空前一定会先用 VACUUM INTO 存一份备份（backup/pos-before-reset-*.db）。
     *
     * @param demo true=清空后重新写入 6 个演示商品，方便试系统
     */
    @PostMapping("/reset")
    public Map<String, Object> reset(@RequestParam(defaultValue = "false") boolean demo) throws Exception {
        Path dir = Path.of("backup");
        Files.createDirectories(dir);
        String name = "pos-before-reset-" + DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").format(LocalDateTime.now()) + ".db";
        Path out = dir.resolve(name).toAbsolutePath();
        String target = out.toString().replace("\\", "/").replace("'", "''");
        jdbc.execute("VACUUM INTO '" + target + "'");

        String[] tables = {
                "order_item", "payment", "orders", "held", "shift",
                "inventory_movement", "stock", "product_barcode", "product",
                "device", "category", "op_log", "seq"
        };
        for (String t : tables) {
            try {
                jdbc.update("DELETE FROM " + t);
            } catch (Exception ignore) {
                // 表不存在就跳过，保证老库也能升级
            }
        }
        for (String t : tables) {
            try {
                jdbc.update("DELETE FROM sqlite_sequence WHERE name=?", t);
            } catch (Exception ignore) { }
        }

        jdbc.update("DELETE FROM settings");
        defaultSetting("shop_name", "我的小店");
        defaultSetting("shop_address", "");
        defaultSetting("shop_phone", "");
        defaultSetting("receipt_footer", "谢谢惠顾，欢迎再次光临");
        defaultSetting("paper_width", "80");
        defaultSetting("allow_negative", "0");
        defaultSetting("auto_print", "0");

        jdbc.update("INSERT INTO category(name,sort) VALUES('饮料',1)");
        jdbc.update("INSERT INTO category(name,sort) VALUES('零食',2)");
        jdbc.update("INSERT INTO category(name,sort) VALUES('日用',3)");

        int products = 0;
        if (demo) products = seedDemo();

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("backup", "backup/" + name);
        r.put("products", products);
        r.put("msg", "已初始化" + (demo ? "，并写入 " + products + " 个演示商品" : "") + "，旧数据已备份到 " + name);
        return r;
    }

    private void defaultSetting(String k, String v) {
        jdbc.update("INSERT OR IGNORE INTO settings(k, v) VALUES(?,?)", k, v);
    }

    private int seedDemo() {
        Object[][] data = {
                {"农夫山泉 550ml", "6900000000001", 70L, 120L, 1L, 50L},
                {"可口可乐 330ml", "6900000000002", 170L, 250L, 1L, 40L},
                {"乐事薯片 原味", "6900000000003", 240L, 350L, 2L, 30L},
                {"奥利奥饼干", "6900000000004", 250L, 350L, 2L, 20L},
                {"抽纸 3层", "6900000000005", 550L, 800L, 3L, 15L},
                {"洗衣液 1kg", "6900000000006", 1100L, 1500L, 3L, 10L}
        };
        long now = System.currentTimeMillis();
        for (Object[] d : data) {
            jdbc.update("INSERT INTO product(name,category_id,unit,is_weight,cost_price,sale_price,stock_alert,status,demo,created_at,updated_at)" +
                            " VALUES(?,?, '件',0,?,?,5,1,1,?,?)",
                    d[0], d[4], d[2], d[3], now, now);
            long pid = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
            jdbc.update("INSERT INTO product_barcode(product_id,barcode) VALUES(?,?)", pid, d[1]);
            jdbc.update("INSERT INTO stock(product_id,qty,updated_at) VALUES(?,?,?)", pid, d[5], now);
            jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,ref_no,note,device_id,occur_at)" +
                    " VALUES(?, 'in', ?, 'DEMO', '演示数据初始库存', 'admin', ?)", pid, d[5], now);
        }
        return data.length;
    }
}
