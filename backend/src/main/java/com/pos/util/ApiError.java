package com.pos.util;

public class ApiError extends RuntimeException {
    public ApiError(String message) {
        super(message);
    }
}
