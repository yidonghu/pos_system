package com.pos.web;

import com.pos.util.Tokens;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final Tokens tokens;

    public AuthInterceptor(Tokens tokens) {
        this.tokens = tokens;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        String uri = request.getRequestURI();
        if (uri.equals("/api/admin/login")) return true;

        if (tokens.valid(request.getHeader("X-Admin-Token"))) return true;

        response.setStatus(401);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"ok\":false,\"msg\":\"请先登录管理后台\"}");
        return false;
    }
}
