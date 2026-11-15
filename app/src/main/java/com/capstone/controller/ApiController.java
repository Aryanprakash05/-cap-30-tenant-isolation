package com.capstone.controller;

import com.capstone.exception.AccessDeniedException;
import com.capstone.service.AuthService;
import com.capstone.service.SnowflakeService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"}, allowedHeaders = "*")
public class ApiController {

    private static final Logger log = LoggerFactory.getLogger(ApiController.class);

    private final SnowflakeService snowflakeService;
    private final AuthService authService;

    public ApiController(SnowflakeService snowflakeService, AuthService authService) {
        this.snowflakeService = snowflakeService;
        this.authService = authService;
    }

    // Identity comes only from the server-side session token. There is
    // deliberately no X-Role header fallback: trusting a client-sent role
    // would let anyone read any tenant with curl and no login.
    private String resolveRole(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7).trim();
            return authService.getRoleForToken(token);
        }
        return null;
    }

    private ResponseEntity<Map<String, Object>> badRequest(String message) {
        return ResponseEntity.badRequest().body(Map.of("error", message));
    }

    // Attach the Snowflake query ID of the last statement on this thread,
    // when one was captured, so the UI can show it as audit evidence.
    private ResponseEntity<?> withQueryId(Object body) {
        String qid = snowflakeService.lastQueryId();
        if (qid != null && !qid.isBlank()) {
            return ResponseEntity.ok().header("X-Snowflake-Query-Id", qid).body(body);
        }
        return ResponseEntity.ok(body);
    }

    // -------------------------------------------------------------------------
    // Authentication Endpoints
    // -------------------------------------------------------------------------

    @PostMapping("/auth/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> creds) {
        String username = creds.get("username");
        String password = creds.get("password");
        try {
            String token = authService.login(username, password);
            String role = authService.getRoleForToken(token);
            String tenant;
            if ("CAPSTONE_SUPPORT".equalsIgnoreCase(role)) {
                tenant = "ALL";
            } else {
                tenant = snowflakeService.tenantForRole(role);
            }
            return ResponseEntity.ok(Map.of(
                    "token", token,
                    "role", role,
                    "tenant", tenant,
                    "username", username
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/auth/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpServletRequest request) {
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7).trim();
            authService.logout(token);
        }
        return ResponseEntity.ok(Map.of("status", "logged_out"));
    }

    // -------------------------------------------------------------------------
    // Analytics Endpoints
    // -------------------------------------------------------------------------

    // The tenant is optional: when it is absent the service derives it from
    // the session role (analysts get their own tenant, support gets the
    // single active grant's tenant). When it is present and does not match
    // the caller's scope, the service denies it — that is the denial the
    // Evidence screen's "Try to break it" panel relies on.
    @GetMapping("/kpis")
    public ResponseEntity<?> getKpis(HttpServletRequest request,
            @RequestParam(required = false) String tenant) {
        String role = resolveRole(request);
        if (role == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return withQueryId(snowflakeService.getKpis(role, tenant));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/orders")
    public ResponseEntity<?> getOrders(HttpServletRequest request,
            @RequestParam(required = false) String tenant) {
        String role = resolveRole(request);
        if (role == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return withQueryId(snowflakeService.getOrders(role, tenant));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/orders/{orderId}")
    public ResponseEntity<?> getOrder(HttpServletRequest request,
            @RequestParam(required = false) String tenant, @PathVariable String orderId) {
        String role = resolveRole(request);
        if (role == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            Map<String, Object> order = snowflakeService.getOrder(role, tenant, orderId);
            if (order.isEmpty()) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Order not found or not accessible"));
            }
            return withQueryId(order);
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/analytics/summary")
    public ResponseEntity<?> getAnalyticsSummary(HttpServletRequest request,
            @RequestParam(required = false) String tenant) {
        String role = resolveRole(request);
        if (role == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return withQueryId(snowflakeService.getAnalyticsSummary(role, tenant));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/customers")
    public ResponseEntity<?> getCustomers(HttpServletRequest request,
            @RequestParam(required = false) String tenant) {
        String role = resolveRole(request);
        if (role == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return withQueryId(snowflakeService.getCustomers(role, tenant));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/products")
    public ResponseEntity<?> getProducts(HttpServletRequest request,
            @RequestParam(required = false) String tenant) {
        String role = resolveRole(request);
        if (role == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return withQueryId(snowflakeService.getProducts(role, tenant));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    // -------------------------------------------------------------------------
    // Support Workflow Endpoints
    // -------------------------------------------------------------------------

    @PostMapping("/support/grant")
    public ResponseEntity<?> requestSupportGrant(HttpServletRequest request, @RequestBody Map<String, Object> payload) {
        String role = resolveRole(request);
        if (role == null || (!"CAPSTONE_SUPPORT".equalsIgnoreCase(role) && !"CAPSTONE_ADMIN".equalsIgnoreCase(role))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only support principals can request break-glass access"));
        }
        String reason = (String) payload.get("reason");
        String tenant = (String) payload.get("tenant");
        int durationMinutes = payload.get("durationMinutes") != null ? ((Number) payload.get("durationMinutes")).intValue() : 60;

        try {
            Object result = snowflakeService.callSupportGrant(reason, tenant, durationMinutes);
            // The procedure returns validation failures as plain strings
            // ("ERROR: ...") instead of raising, so map those to HTTP 400.
            if (result instanceof String s && s.startsWith("ERROR:")) {
                return ResponseEntity.badRequest().body(Map.of("error", s));
            }
            return ResponseEntity.ok(Map.of("status", "SUCCESS", "message", String.valueOf(result)));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/support/status")
    public ResponseEntity<?> getSupportStatus(HttpServletRequest request) {
        String role = resolveRole(request);
        if (role == null || (!"CAPSTONE_SUPPORT".equalsIgnoreCase(role) && !"CAPSTONE_ADMIN".equalsIgnoreCase(role))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only support principals can view support status"));
        }
        try {
            List<Map<String, Object>> statusList = snowflakeService.getSupportStatus();
            return withQueryId(statusList);
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/support/customers")
    public ResponseEntity<?> getSupportCustomers(HttpServletRequest request) {
        String role = resolveRole(request);
        if (role == null || (!"CAPSTONE_SUPPORT".equalsIgnoreCase(role) && !"CAPSTONE_ADMIN".equalsIgnoreCase(role))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only support principals can view support customers"));
        }
        try {
            List<Map<String, Object>> customers = snowflakeService.getSupportCustomers();
            return withQueryId(customers);
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/support/revoke")
    public ResponseEntity<?> revokeSupportGrant(HttpServletRequest request) {
        String role = resolveRole(request);
        if (role == null || (!"CAPSTONE_SUPPORT".equalsIgnoreCase(role) && !"CAPSTONE_ADMIN".equalsIgnoreCase(role))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only support principals can end break-glass access"));
        }
        try {
            Object result = snowflakeService.callSupportRevoke();
            String message = String.valueOf(result);
            if (message.startsWith("ERROR:")) {
                return ResponseEntity.badRequest().body(Map.of("error", message));
            }
            String status = message.startsWith("REVOKED:") ? "REVOKED" : "NO_ACTIVE_GRANT";
            return ResponseEntity.ok(Map.of("status", status, "message", message));
        } catch (AccessDeniedException e) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/support/history")
    public ResponseEntity<?> getSupportHistory(HttpServletRequest request) {
        String role = resolveRole(request);
        if (role == null || (!"CAPSTONE_SUPPORT".equalsIgnoreCase(role) && !"CAPSTONE_ADMIN".equalsIgnoreCase(role))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only support principals can view access history"));
        }
        try {
            List<Map<String, Object>> history = snowflakeService.getSupportHistory(role);
            return withQueryId(history);
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    // -------------------------------------------------------------------------
    // Isolation Evidence
    // -------------------------------------------------------------------------

    @PostMapping("/evidence/run")
    public ResponseEntity<?> runEvidence(HttpServletRequest request) {
        if (resolveRole(request) == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return ResponseEntity.ok(snowflakeService.runEvidenceTests());
        } catch (Exception e) {
            log.error("Evidence run failed: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    // -------------------------------------------------------------------------
    // Usage & Health Endpoints
    // -------------------------------------------------------------------------

    @GetMapping("/usage")
    public ResponseEntity<?> getUsage(HttpServletRequest request) {
        if (resolveRole(request) == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return withQueryId(snowflakeService.getUsageStats());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    // Ingestion health is staff-only: it names files and rejected rows, which
    // is platform operations data, not tenant data. There is no separate
    // admin login, so CAPSTONE_SUPPORT is the staff role that may see it.
    @GetMapping("/ingestion")
    public ResponseEntity<?> getIngestion(HttpServletRequest request) {
        String role = resolveRole(request);
        if (role == null || (!"CAPSTONE_SUPPORT".equalsIgnoreCase(role) && !"CAPSTONE_ADMIN".equalsIgnoreCase(role))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Only staff can view ingestion health"));
        }
        try {
            return withQueryId(snowflakeService.getIngestionHealth());
        } catch (SQLException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<?> getHealth() {
        boolean sfOk = snowflakeService.testConnectivity();
        Map<String, Object> warehouse = snowflakeService.getWarehouseState();
        Map<String, Object> health = Map.of(
                "status", sfOk ? "UP" : "DEGRADED",
                "snowflake", sfOk ? "CONNECTED" : "UNREACHABLE_OR_AUTHENTICATION_PENDING",
                "warehouse", warehouse,
                "timestamp", Instant.now().toString()
        );
        return sfOk ? ResponseEntity.ok(health) : ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(health);
    }
}
