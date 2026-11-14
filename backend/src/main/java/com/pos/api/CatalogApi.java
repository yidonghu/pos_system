package com.pos.api;

import com.pos.util.ApiError;
import com.pos.util.Csv;
import com.pos.util.Nums;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class CatalogApi {

    private final JdbcTemplate jdbc;

    public CatalogApi(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String PRODUCT_SELECT =
            "SELECT p.id,p.name,p.category_id,p.unit,p.is_weight,p.cost_price,p.sale_price,p.stock_alert,p.status,p.demo," +
            " COALESCE(s.qty,0) AS stock," +
            " (SELECT group_concat(b.barcode,'|') FROM product_barcode b WHERE b.product_id=p.id) AS barcodes," +
            " (SELECT c.name FROM category c WHERE c.id=p.category_id) AS category_name" +
            " FROM product p LEFT JOIN stock s ON s.product_id=p.id ";

    // ---------- 分类 ----------

    @GetMapping("/categories")
    public List<Map<String, Object>> categories() {
        return jdbc.queryForList(
                "SELECT c.id,c.name,c.sort,(SELECT COUNT(*) FROM product p WHERE p.category_id=c.id AND p.status=1) AS cnt" +
                        " FROM category c ORDER BY c.sort,c.id");
    }

    @PostMapping("/admin/categories")
    public Map<String, Object> addCategory(@RequestBody Map<String, Object> body) {
        String name = Nums.s(body.get("name")).trim();
        if (name.isEmpty()) throw new ApiError("分类名不能为空");
        jdbc.update("INSERT INTO category(name,sort) VALUES(?,?)", name, Nums.i(body.get("sort"), 99));
        return Map.of("ok", true, "id", jdbc.queryForObject("SELECT last_insert_rowid()", Long.class));
    }

    @PutMapping("/admin/categories/{id}")
    public Map<String, Object> updateCategory(@PathVariable long id, @RequestBody Map<String, Object> body) {
        String name = Nums.s(body.get("name")).trim();
        if (name.isEmpty()) throw new ApiError("分类名不能为空");
        jdbc.update("UPDATE category SET name=?, sort=? WHERE id=?", name, Nums.i(body.get("sort"), 99), id);
        return Map.of("ok", true);
    }

    @DeleteMapping("/admin/categories/{id}")
    public Map<String, Object> deleteCategory(@PathVariable long id) {
        Integer used = jdbc.queryForObject("SELECT COUNT(*) FROM product WHERE category_id=?", Integer.class, id);
        if (used != null && used > 0) throw new ApiError("该分类下还有 " + used + " 个商品，不能删除");
        jdbc.update("DELETE FROM category WHERE id=?", id);
        return Map.of("ok", true);
    }

    // ---------- 商品（收银端） ----------

    @GetMapping("/products")
    public List<Map<String, Object>> products(
            @RequestParam(value = "kw", required = false) String kw,
            @RequestParam(value = "cat", required = false) Long cat,
            @RequestParam(value = "limit", required = false, defaultValue = "300") int limit) {
        StringBuilder sql = new StringBuilder(PRODUCT_SELECT).append(" WHERE p.status=1 ");
        List<Object> args = new ArrayList<>();
        if (kw != null && !kw.isBlank()) {
            sql.append(" AND (p.name LIKE ? OR EXISTS(SELECT 1 FROM product_barcode b WHERE b.product_id=p.id AND b.barcode LIKE ?)) ");
            args.add("%" + kw.trim() + "%");
            args.add("%" + kw.trim() + "%");
        }
        if (cat != null && cat > 0) {
            sql.append(" AND p.category_id=? ");
            args.add(cat);
        }
        sql.append(" ORDER BY p.id DESC LIMIT ?");
        args.add(Math.min(limit, 1000));
        return jdbc.queryForList(sql.toString(), args.toArray());
    }

    @GetMapping("/products/barcode/{code}")
    public Map<String, Object> byBarcode(@PathVariable String code) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                PRODUCT_SELECT + " WHERE p.status=1 AND p.id IN (SELECT product_id FROM product_barcode WHERE barcode=?) LIMIT 1",
                code);
        if (rows.isEmpty()) throw new ApiError("未找到条码 " + code + " 对应的商品");
        return rows.get(0);
    }

    // ---------- 商品（后台） ----------

    @GetMapping("/admin/products")
    public Map<String, Object> adminProducts(
            @RequestParam(value = "kw", required = false) String kw,
            @RequestParam(value = "cat", required = false) Long cat,
            @RequestParam(value = "page", required = false, defaultValue = "1") int page,
            @RequestParam(value = "size", required = false, defaultValue = "20") int size) {
        StringBuilder filter = new StringBuilder(" WHERE 1=1 ");
        List<Object> args = new ArrayList<>();
        if (kw != null && !kw.isBlank()) {
            filter.append(" AND (p.name LIKE ? OR EXISTS(SELECT 1 FROM product_barcode b WHERE b.product_id=p.id AND b.barcode LIKE ?)) ");
            args.add("%" + kw.trim() + "%");
            args.add("%" + kw.trim() + "%");
        }
        if (cat != null && cat > 0) {
            filter.append(" AND p.category_id=? ");
            args.add(cat);
        }

        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM product p " + filter, Integer.class, args.toArray());

        int pageSize = Math.min(Math.max(size, 1), 200);
        int offset = Math.max(page - 1, 0) * pageSize;
        String sql = PRODUCT_SELECT + filter + " ORDER BY p.id DESC LIMIT ? OFFSET ?";
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(pageSize);
        pageArgs.add(offset);

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("total", total == null ? 0 : total);
        r.put("page", page);
        r.put("size", pageSize);
        r.put("list", jdbc.queryForList(sql, pageArgs.toArray()));
        return r;
    }

    @PostMapping("/admin/products")
    public Map<String, Object> createProduct(@RequestBody Map<String, Object> body) {
        String name = Nums.s(body.get("name")).trim();
        if (name.isEmpty()) throw new ApiError("商品名不能为空");
        long now = System.currentTimeMillis();
        long cost = Nums.l(body.get("cost_price"));
        long price = Nums.l(body.get("sale_price"));
        if (price < 0 || cost < 0) throw new ApiError("价格不能为负");

        jdbc.update("INSERT INTO product(name,category_id,unit,is_weight,cost_price,sale_price,stock_alert,status,image,demo,created_at,updated_at)" +
                        " VALUES(?,?,?,?,?,?,?,1,NULL,0,?,?)",
                name,
                body.get("category_id") == null ? null : Nums.l(body.get("category_id")),
                Nums.s(body.get("unit"), "件"),
                Nums.i(body.get("is_weight"), 0),
                cost, price,
                Nums.i(body.get("stock_alert"), 5),
                now, now);
        long pid = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
        saveBarcodes(pid, body.get("barcodes"));
        long stock = Nums.l(body.get("stock"));
        jdbc.update("INSERT INTO stock(product_id,qty,updated_at) VALUES(?,?,?)", pid, stock, now);
        if (stock > 0) {
            jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,ref_no,note,device_id,occur_at)" +
                            " VALUES(?, 'in', ?, 'NEW', '商品建档初始库存', 'admin', ?)",
                    pid, stock, now);
        }
        return Map.of("ok", true, "id", pid);
    }

    @PutMapping("/admin/products/{id}")
    public Map<String, Object> updateProduct(@PathVariable long id, @RequestBody Map<String, Object> body) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM product WHERE id=?", id);
        if (rows.isEmpty()) throw new ApiError("商品不存在");
        Map<String, Object> old = rows.get(0);

        String name = body.containsKey("name") ? Nums.s(body.get("name")).trim() : Nums.s(old.get("name"));
        if (name.isEmpty()) throw new ApiError("商品名不能为空");

        jdbc.update("UPDATE product SET name=?, category_id=?, unit=?, is_weight=?, cost_price=?, sale_price=?, stock_alert=?, status=?, updated_at=?" +
                        " WHERE id=?",
                name,
                body.containsKey("category_id") ? (body.get("category_id") == null ? null : Nums.l(body.get("category_id"))) : old.get("category_id"),
                Nums.s(body.get("unit"), Nums.s(old.get("unit"), "件")),
                body.containsKey("is_weight") ? Nums.i(body.get("is_weight"), 0) : Nums.i(old.get("is_weight"), 0),
                body.containsKey("cost_price") ? Nums.l(body.get("cost_price")) : Nums.l(old.get("cost_price")),
                body.containsKey("sale_price") ? Nums.l(body.get("sale_price")) : Nums.l(old.get("sale_price")),
                body.containsKey("stock_alert") ? Nums.i(body.get("stock_alert"), 5) : Nums.i(old.get("stock_alert"), 5),
                body.containsKey("status") ? Nums.i(body.get("status"), 1) : Nums.i(old.get("status"), 1),
                System.currentTimeMillis(),
                id);

        if (body.containsKey("barcodes")) saveBarcodes(id, body.get("barcodes"));
        return Map.of("ok", true);
    }

    @DeleteMapping("/admin/products/{id}")
    public Map<String, Object> deleteProduct(@PathVariable long id) {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT id,status FROM product WHERE id=?", id);
        if (rows.isEmpty()) throw new ApiError("商品不存在");
        long used = jdbc.queryForObject("SELECT COUNT(1) FROM order_item WHERE product_id=?", Long.class, id);
        if (used > 0) {
            // 卖过的商品物理删除会让历史订单失去名称，只下架
            jdbc.update("UPDATE product SET status=0, updated_at=? WHERE id=?", System.currentTimeMillis(), id);
            return Map.of("ok", true, "hard", false, "msg", "该商品有历史订单，已下架（订单与报表保留）");
        }
        jdbc.update("DELETE FROM product_barcode WHERE product_id=?", id);
        jdbc.update("DELETE FROM stock WHERE product_id=?", id);
        jdbc.update("DELETE FROM product WHERE id=?", id);
        return Map.of("ok", true, "hard", true, "msg", "已删除");
    }

    /** 条码清洗：去掉 Excel 包裹、前导单引号，并把科学计数法还原成整数串 */
    static String normBarcode(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return "";
        if (s.startsWith("=")) s = s.substring(1).trim();
        if (s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"")) s = s.substring(1, s.length() - 1).trim();
        if (s.startsWith("'")) s = s.substring(1).trim();
        if (s.matches("[+-]?(\\d+(\\.\\d*)?|\\.\\d+)[eE][+-]?\\d+")) {
            try {
                java.math.BigDecimal bd = new java.math.BigDecimal(s);
                s = bd.toPlainString();
                if (s.endsWith(".0")) s = s.substring(0, s.length() - 2);
            } catch (Exception ignore) { }
        }
        return s.trim();
    }

    private void saveBarcodes(long productId, Object listObj) {
        jdbc.update("DELETE FROM product_barcode WHERE product_id=?", productId);
        if (!(listObj instanceof List<?> list)) return;
        java.util.Set<String> seen = new java.util.LinkedHashSet<>();
        for (Object o : list) {
            for (String part : Nums.s(o).split("[,，\\s]+")) {
                String code = normBarcode(part);
                // 同一个码只登记一次
                if (code.isEmpty() || !seen.add(code)) continue;
                // 同一条码已被别的商品占着，自动从旧商品解绑，保证一码一商品
                jdbc.update("DELETE FROM product_barcode WHERE barcode=? AND product_id<>?", code, productId);
                jdbc.update("INSERT INTO product_barcode(product_id,barcode) VALUES(?,?)", productId, code);
            }
        }
    }

    // ---------- 导入导出 ----------

    @GetMapping(value = "/admin/products/export.csv", produces = "text/csv;charset=UTF-8")
    public org.springframework.http.ResponseEntity<String> exportCsv() {
        List<String> headers = List.of("商品ID", "名称", "分类", "条码", "单位", "进价(元)", "售价(元)", "库存", "预警值", "状态");
        List<List<String>> rows = new ArrayList<>();
        List<Map<String, Object>> list = jdbc.queryForList(PRODUCT_SELECT + " ORDER BY p.id");
        for (Map<String, Object> p : list) {
            rows.add(List.of(
                    Nums.s(p.get("id")),
                    Nums.s(p.get("name")),
                    Nums.s(p.get("category_name")),
                    excelText(Nums.s(p.get("barcodes"))),
                    Nums.s(p.get("unit")),
                    Nums.fenToYuan(Nums.l(p.get("cost_price"))),
                    Nums.fenToYuan(Nums.l(p.get("sale_price"))),
                    Nums.s(p.get("stock")),
                    Nums.s(p.get("stock_alert")),
                    Nums.i(p.get("status"), 1) == 1 ? "在售" : "下架"
            ));
        }
        String csv = Csv.build(headers, rows);
        return org.springframework.http.ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"products.csv\"")
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(csv);
    }

    /** 导出时把可能被 Excel 当数字的字段写成 ="xxx"，避免长条码被截断成 6.02E+12 */
    private String excelText(String v) {
        if (v == null || v.trim().isEmpty()) return "";
        if (v.trim().matches("[0-9+\\-().,|\\s]+")) return "=\"" + v.trim().replace("\"", "\"\"") + "\"";
        return v;
    }

    @PostMapping("/admin/products/import")
    public Map<String, Object> importCsv(@RequestBody String text) {
        List<List<String>> rows = Csv.parse(text);
        if (rows.size() < 2) throw new ApiError("文件内容为空或缺少标题行");

        List<String> header = rows.get(0);
        Map<String, Integer> idx = new HashMap<>();
        for (int i = 0; i < header.size(); i++) idx.put(header.get(i).trim(), i);

        int created = 0, updated = 0, skipped = 0;
        List<String> errors = new ArrayList<>();
        long now = System.currentTimeMillis();

        for (int i = 1; i < rows.size(); i++) {
            List<String> row = rows.get(i);
            String name = get(row, idx, "名称");
            String rawBarcode = get(row, idx, "条码");
            String barcode = normBarcode(rawBarcode);
            if (rawBarcode.matches("[+-]?(\\d+(\\.\\d*)?|\\.\\d+)[eE][+-]?\\d+")) {
                errors.add("第 " + (i + 1) + " 行: 条码 " + rawBarcode + " 被 Excel 存成科学计数法，已还原为 " + barcode + "，请核对位数");
            }
            if (name.isEmpty() && barcode.isEmpty()) {
                skipped++;
                continue;
            }
            try {
                String catName = get(row, idx, "分类");
                Long catId = null;
                if (!catName.isEmpty()) {
                    List<Map<String, Object>> c = jdbc.queryForList("SELECT id FROM category WHERE name=?", catName);
                    if (c.isEmpty()) {
                        jdbc.update("INSERT INTO category(name,sort) VALUES(?,99)", catName);
                        catId = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
                    } else {
                        catId = Nums.l(c.get(0).get("id"));
                    }
                }
                long cost = Nums.yuanToFen(get(row, idx, "进价"));
                long price = Nums.yuanToFen(get(row, idx, "售价"));
                int alert = (int) Nums.l(get(row, idx, "预警值"), 5);
                String unit = get(row, idx, "单位");
                if (unit.isEmpty()) unit = "件";

                List<String> codes = new ArrayList<>();
                for (String part : barcode.split("[|,，\\s]+")) {
                    String c = normBarcode(part);
                    if (!c.isEmpty() && !codes.contains(c)) codes.add(c);
                }
                String primary = codes.isEmpty() ? "" : codes.get(0);

                Long existId = null;
                for (String c : codes) {
                    List<Map<String, Object>> e = jdbc.queryForList(
                            "SELECT product_id FROM product_barcode WHERE barcode=?", c);
                    if (!e.isEmpty()) { existId = Nums.l(e.get(0).get("product_id")); break; }
                }

                if (existId != null) {
                    jdbc.update("UPDATE product SET name=?,category_id=?,unit=?,cost_price=?,sale_price=?,stock_alert=?,updated_at=? WHERE id=?",
                            name.isEmpty() ? ("商品" + primary) : name, catId, unit, cost, price, alert, now, existId);
                    if (!codes.isEmpty()) saveBarcodes(existId, codes);
                    updated++;
                } else {
                    jdbc.update("INSERT INTO product(name,category_id,unit,is_weight,cost_price,sale_price,stock_alert,status,demo,created_at,updated_at)" +
                                    " VALUES(?,?,?,0,?,?,?,1,0,?,?)",
                            name.isEmpty() ? ("商品" + primary) : name, catId, unit, cost, price, alert, now, now);
                    long pid = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
                    if (!codes.isEmpty()) saveBarcodes(pid, codes);
                    long stock = Nums.l(get(row, idx, "库存"));
                    jdbc.update("INSERT INTO stock(product_id,qty,updated_at) VALUES(?,?,?)", pid, stock, now);
                    if (stock > 0) {
                        jdbc.update("INSERT INTO inventory_movement(product_id,type,qty,ref_no,note,device_id,occur_at)" +
                                " VALUES(?, 'in', ?, 'IMPORT', '导入初始库存', 'admin', ?)", pid, stock, now);
                    }
                    created++;
                }
            } catch (Exception e) {
                errors.add("第 " + (i + 1) + " 行: " + e.getMessage());
            }
        }

        Map<String, Object> r = new LinkedHashMap<>();
        r.put("ok", true);
        r.put("created", created);
        r.put("updated", updated);
        r.put("skipped", skipped);
        r.put("errors", errors.subList(0, Math.min(errors.size(), 20)));
        return r;
    }

    private String get(List<String> row, Map<String, Integer> idx, String key) {
        Integer i = idx.get(key);
        if (i == null || i >= row.size()) return "";
        return row.get(i) == null ? "" : row.get(i).trim();
    }
}
