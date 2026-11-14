package com.pos.util;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public class Sha {
    public static String hash(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(("pos$v1$" + raw).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static boolean matches(String raw, String hash) {
        return hash != null && hash.equals(hash(raw));
    }
}
