package com.pos.util;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;

public class Nums {

    public static long l(Object o, long def) {
        if (o == null) return def;
        if (o instanceof Number n) return n.longValue();
        String s = String.valueOf(o).trim();
        if (s.isEmpty()) return def;
        try {
            return Long.parseLong(s);
        } catch (Exception e) {
            try {
                return new BigDecimal(s).setScale(0, RoundingMode.HALF_UP).longValue();
            } catch (Exception ex) {
                return def;
            }
        }
    }

    public static long l(Object o) {
        return l(o, 0L);
    }

    public static int i(Object o, int def) {
        return (int) l(o, def);
    }

    public static int i(Object o) {
        return (int) l(o, 0);
    }

    public static String s(Object o, String def) {
        if (o == null) return def;
        String s = String.valueOf(o);
        return s;
    }

    public static String s(Object o) {
        return s(o, "");
    }

    public static Map<String, Object> map(Object o) {
        if (o instanceof Map<?, ?> m) {
            @SuppressWarnings("unchecked")
            Map<String, Object> r = (Map<String, Object>) m;
            return r;
        }
        return Map.of();
    }

    /** 元 -> 分 */
    public static long yuanToFen(String yuan) {
        if (yuan == null || yuan.trim().isEmpty()) return 0L;
        String s = yuan.trim().replace("¥", "").replace("￥", "").replace(",", "");
        return new BigDecimal(s).multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).longValue();
    }

    /** 分 -> 元字符串 */
    public static String fenToYuan(long fen) {
        return BigDecimal.valueOf(fen).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP).toPlainString();
    }
}
