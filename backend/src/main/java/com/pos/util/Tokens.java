package com.pos.util;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class Tokens {

    private static final long TTL_MS = 12L * 60 * 60 * 1000;
    private final Map<String, Long> store = new ConcurrentHashMap<>();

    public String issue() {
        String token = UUID.randomUUID().toString().replace("-", "");
        store.put(token, System.currentTimeMillis() + TTL_MS);
        return token;
    }

    public boolean valid(String token) {
        if (token == null || token.isEmpty()) return false;
        Long exp = store.get(token);
        if (exp == null) return false;
        if (exp < System.currentTimeMillis()) {
            store.remove(token);
            return false;
        }
        return true;
    }

    public void revoke(String token) {
        if (token != null) store.remove(token);
    }
}
