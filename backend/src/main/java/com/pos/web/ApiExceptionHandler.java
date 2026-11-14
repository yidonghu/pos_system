package com.pos.web;

import com.pos.util.ApiError;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    private Map<String, Object> body(String msg) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", false);
        m.put("msg", msg);
        return m;
    }

    @ExceptionHandler(ApiError.class)
    public ResponseEntity<Map<String, Object>> apiError(ApiError e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body(e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> other(Exception e) {
        e.printStackTrace();
        String msg = e.getMessage();
        if (msg == null || msg.isBlank()) msg = e.getClass().getSimpleName();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(body("服务异常: " + msg));
    }
}
