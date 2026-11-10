package com.capstone.controller;

import com.capstone.service.SnowflakeService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"}, allowedHeaders = "*")
public class ApiController {

    private final SnowflakeService snowflakeService;

    public ApiController(SnowflakeService snowflakeService) {
        this.snowflakeService = snowflakeService;
    }

    private ResponseEntity<Map<String, Object>> forbidden(String role, String tenant) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                "error", "Access denied",
                "detail", "Role " + role + " is not allowed to access tenant " + tenant
        ));
    }

    private boolean tenantMatchesRole(String role, String tenant) {
        try {
            return snowflakeService.tenantForRole(role).equalsIgnoreCase(tenant);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    @GetMapping("/kpis")
    public ResponseEntity<Map<String, Object>> getKpis(
            @RequestHeader("X-Role") String role,
            @RequestParam String tenant) {
        if (!tenantMatchesRole(role, tenant)) {
            return forbidden(role, tenant);
        }
        try {
            return ResponseEntity.ok(snowflakeService.getKpis(role));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (SQLException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/orders")
    public ResponseEntity<List<Map<String, Object>>> getOrders(
            @RequestHeader("X-Role") String role,
            @RequestParam String tenant) {
        if (!tenantMatchesRole(role, tenant)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(List.of());
        }
        try {
            return ResponseEntity.ok(snowflakeService.getOrders(role));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(List.of());
        } catch (SQLException e) {
            return ResponseEntity.internalServerError().body(List.of());
        }
    }

    @GetMapping("/orders/{orderId}")
    public ResponseEntity<Map<String, Object>> getOrder(
            @RequestHeader("X-Role") String role,
            @RequestParam String tenant,
            @PathVariable String orderId) {
        if (!tenantMatchesRole(role, tenant)) {
            return forbidden(role, tenant);
        }
        try {
            Map<String, Object> order = snowflakeService.getOrder(role, orderId);
            if (order.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            return ResponseEntity.ok(order);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (SQLException e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
