package com.pos.db;

import com.pos.util.Sha;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class DbInit implements ApplicationRunner {

    private final JdbcTemplate jdbc;

    public DbInit(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String[] DDL = {
            "CREATE TABLE IF NOT EXISTS schema_version(ver INTEGER PRIMARY KEY, applied_at INTEGER)",

            "CREATE TABLE IF NOT EXISTS admin(" +
                    " id INTEGER PRIMARY KEY," +
                    " password_hash TEXT NOT NULL," +
                    " updated_at INTEGER NOT NULL)",

            "CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL)",

            "CREATE TABLE IF NOT EXISTS device(" +
                    " id TEXT PRIMARY KEY," +
                    " name TEXT NOT NULL," +
                    " type TEXT NOT NULL DEFAULT 'pc'," +
                    " permissions TEXT NOT NULL DEFAULT '{}'," +
                    " enabled INTEGER NOT NULL DEFAULT 1," +
                    " bind_code TEXT," +
                    " created_at INTEGER NOT NULL," +
                    " last_seen INTEGER)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_device_bind ON device(bind_code)",

            "CREATE TABLE IF NOT EXISTS category(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " name TEXT NOT NULL," +
                    " sort INTEGER NOT NULL DEFAULT 0)",

            "CREATE TABLE IF NOT EXISTS product(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " name TEXT NOT NULL," +
                    " category_id INTEGER," +
                    " unit TEXT NOT NULL DEFAULT '件'," +
                    " is_weight INTEGER NOT NULL DEFAULT 0," +
                    " cost_price INTEGER NOT NULL DEFAULT 0," +
                    " sale_price INTEGER NOT NULL DEFAULT 0," +
                    " stock_alert INTEGER NOT NULL DEFAULT 5," +
                    " status INTEGER NOT NULL DEFAULT 1," +
                    " image TEXT," +
                    " demo INTEGER NOT NULL DEFAULT 0," +
                    " created_at INTEGER," +
                    " updated_at INTEGER)",

            "CREATE TABLE IF NOT EXISTS product_barcode(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " product_id INTEGER NOT NULL," +
                    " barcode TEXT NOT NULL)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_barcode ON product_barcode(barcode)",

            "CREATE TABLE IF NOT EXISTS stock(" +
                    " product_id INTEGER PRIMARY KEY," +
                    " qty INTEGER NOT NULL DEFAULT 0," +
                    " updated_at INTEGER)",

            "CREATE TABLE IF NOT EXISTS inventory_movement(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " product_id INTEGER NOT NULL," +
                    " type TEXT NOT NULL," +
                    " qty INTEGER NOT NULL," +
                    " unit_cost INTEGER," +
                    " ref_no TEXT," +
                    " note TEXT," +
                    " device_id TEXT," +
                    " occur_at INTEGER NOT NULL)",

            "CREATE TABLE IF NOT EXISTS orders(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " order_no TEXT NOT NULL UNIQUE," +
                    " device_id TEXT NOT NULL," +
                    " device_name TEXT NOT NULL," +
                    " total INTEGER NOT NULL," +
                    " discount INTEGER NOT NULL DEFAULT 0," +
                    " round_off INTEGER NOT NULL DEFAULT 0," +
                    " payable INTEGER NOT NULL," +
                    " status TEXT NOT NULL DEFAULT 'paid'," +
                    " shift_id INTEGER," +
                    " remark TEXT," +
                    " refund_of INTEGER," +
                    " occur_at INTEGER NOT NULL)",

            "CREATE TABLE IF NOT EXISTS order_item(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " order_id INTEGER NOT NULL," +
                    " product_id INTEGER," +
                    " barcode TEXT," +
                    " product_name TEXT NOT NULL," +
                    " qty INTEGER NOT NULL," +
                    " price INTEGER NOT NULL," +
                    " amount INTEGER NOT NULL)",

            "CREATE TABLE IF NOT EXISTS payment(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " order_id INTEGER NOT NULL," +
                    " method TEXT NOT NULL," +
                    " amount INTEGER NOT NULL," +
                    " trade_no TEXT)",

            "CREATE TABLE IF NOT EXISTS shift(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " device_id TEXT NOT NULL," +
                    " start_at INTEGER NOT NULL," +
                    " end_at INTEGER," +
                    " opening_cash INTEGER NOT NULL DEFAULT 0," +
                    " cash_expected INTEGER NOT NULL DEFAULT 0," +
                    " cash_actual INTEGER," +
                    " diff INTEGER," +
                    " status TEXT NOT NULL DEFAULT 'open')",

            "CREATE TABLE IF NOT EXISTS held(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " device_id TEXT NOT NULL," +
                    " payload TEXT NOT NULL," +
                    " note TEXT," +
                    " created_at INTEGER NOT NULL)",

            "CREATE TABLE IF NOT EXISTS seq(name TEXT PRIMARY KEY, val INTEGER NOT NULL DEFAULT 0)",

            "CREATE TABLE IF NOT EXISTS op_log(" +
                    " id INTEGER PRIMARY KEY AUTOINCREMENT," +
                    " device_id TEXT," +
                    " device_name TEXT," +
                    " action TEXT NOT NULL," +
                    " detail TEXT," +
                    " occur_at INTEGER NOT NULL)",

            "CREATE INDEX IF NOT EXISTS ix_orders_time ON orders(occur_at)",
            "CREATE INDEX IF NOT EXISTS ix_orders_device ON orders(device_id)",
            "CREATE INDEX IF NOT EXISTS ix_movement_time ON inventory_movement(occur_at)",
            "CREATE INDEX IF NOT EXISTS ix_movement_product ON inventory_movement(product_id, occur_at)"
    };

    @Override
    public void run(ApplicationArguments args) {
        jdbc.execute("PRAGMA journal_mode=WAL");
        jdbc.execute("PRAGMA busy_timeout=5000");
        jdbc.execute("PRAGMA foreign_keys=ON");

        for (String sql : DDL) {
            jdbc.execute(sql);
        }
        jdbc.update("INSERT OR IGNORE INTO schema_version(ver, applied_at) VALUES(1, ?)", System.currentTimeMillis());

        // 启动时清理重复条码：同一条码只保留最早绑定的一条，避免一码多商品
        jdbc.update("DELETE FROM product_barcode WHERE rowid NOT IN (SELECT MIN(rowid) FROM product_barcode GROUP BY barcode)");
        jdbc.update("DELETE FROM product_barcode WHERE product_id NOT IN (SELECT id FROM product)");

        Integer admins = jdbc.queryForObject("SELECT COUNT(*) FROM admin", Integer.class);
        if (admins == null || admins == 0) {
            jdbc.update("INSERT INTO admin(id, password_hash, updated_at) VALUES(1,?,?)",
                    Sha.hash("admin888"), System.currentTimeMillis());
        }

        defaultSetting("shop_name", "我的小店");
        defaultSetting("shop_address", "");
        defaultSetting("shop_phone", "");
        defaultSetting("receipt_footer", "谢谢惠顾，欢迎再次光临");
        defaultSetting("paper_width", "80");
        defaultSetting("allow_negative", "0");
        defaultSetting("auto_print", "0");

        Integer cats = jdbc.queryForObject("SELECT COUNT(*) FROM category", Integer.class);
        if (cats == null || cats == 0) {
            jdbc.update("INSERT INTO category(name, sort) VALUES('饮料',1)");
            jdbc.update("INSERT INTO category(name, sort) VALUES('零食',2)");
            jdbc.update("INSERT INTO category(name, sort) VALUES('日用',3)");
        }

        Integer products = jdbc.queryForObject("SELECT COUNT(*) FROM product", Integer.class);
        if (products == null || products == 0) {
            seedDemo();
        }
    }

    private void defaultSetting(String k, String v) {
        jdbc.update("INSERT OR IGNORE INTO settings(k, v) VALUES(?,?)", k, v);
    }

    private void seedDemo() {
        Object[][] data = {
                {"农夫山泉 550ml", "6900000000001", 70L, 120L, 1, 50},
                {"可口可乐 330ml", "6900000000002", 170L, 250L, 1, 40},
                {"乐事薯片 原味", "6900000000003", 240L, 350L, 2, 30},
                {"奥利奥饼干", "6900000000004", 250L, 350L, 2, 20},
                {"抽纸 3层", "6900000000005", 550L, 800L, 3, 15},
                {"洗衣液 1kg", "6900000000006", 1100L, 1500L, 3, 10}
        };
        long now = System.currentTimeMillis();
        for (Object[] d : data) {
            String name = (String) d[0];
            String barcode = (String) d[1];
            long cost = (Long) d[2];
            long price = (Long) d[3];
            int cat = ((Number) d[4]).intValue();
            int qty = ((Number) d[5]).intValue();

            jdbc.update("INSERT INTO product(name, category_id, unit, is_weight, cost_price, sale_price, stock_alert, status, demo, created_at, updated_at)" +
                            " VALUES(?,?, '件', 0, ?, ?, 5, 1, 1, ?, ?)",
                    name, cat, cost, price, now, now);
            long pid = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
            jdbc.update("INSERT INTO product_barcode(product_id, barcode) VALUES(?,?)", pid, barcode);
            jdbc.update("INSERT INTO stock(product_id, qty, updated_at) VALUES(?,?,?)", pid, qty, now);
            jdbc.update("INSERT INTO inventory_movement(product_id, type, qty, ref_no, note, device_id, occur_at)" +
                    " VALUES(?, 'in', ?, 'DEMO', '演示初始库存', 'system', ?)", pid, qty, now);
        }
    }
}
