package com.capstone.service;

import com.capstone.exception.AccessDeniedException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * Snowflake data-access service.
 *
 * <p>Each public method opens its own short-lived JDBC connection as the
 * role-specific user (no connection pool — demo scale).  The admin connection
 * is used only for ACCOUNT_USAGE / health queries and uses ARYAN05.
 */
@Service
public class SnowflakeService {

    private static final Logger log = LoggerFactory.getLogger(SnowflakeService.class);

    // Last Snowflake query ID issued on this thread, so the API can return it
    // as an X-Snowflake-Query-Id header for the UI to show as audit evidence.
    private static final ThreadLocal<String> LAST_QUERY_ID = new ThreadLocal<>();

    /** Query ID of the last statement run on this thread, or null. */
    public String lastQueryId() {
        return LAST_QUERY_ID.get();
    }

    private static String queryIdOf(java.sql.Statement stmt) {
        try {
            if (stmt instanceof net.snowflake.client.jdbc.SnowflakeStatement ss) {
                String qid = ss.getQueryID();
                if (qid != null && !qid.isBlank()) {
                    return qid;
                }
            }
        } catch (Exception e) {
            log.debug("Could not capture Snowflake query ID: {}", e.getMessage());
        }
        return null;
    }

    private static void captureQueryId(java.sql.Statement stmt) {
        String qid = queryIdOf(stmt);
        if (qid != null) {
            LAST_QUERY_ID.set(qid);
        }
    }

    // -------------------------------------------------------------------------
    // Connection base settings
    // -------------------------------------------------------------------------

    @Value("${snowflake.account}")
    private String account;

    @Value("${snowflake.warehouse}")
    private String warehouse;

    @Value("${snowflake.database}")
    private String database;

    @Value("${snowflake.schema}")
    private String schema;

    // -------------------------------------------------------------------------
    // Per-role user/password pairs (injected from application.properties)
    // -------------------------------------------------------------------------

    @Value("${snowflake.users.TENANT_A_ANALYST.user}")
    private String tenantAUser;
    @Value("${snowflake.users.TENANT_A_ANALYST.password}")
    private String tenantAPassword;

    @Value("${snowflake.users.TENANT_B_ANALYST.user}")
    private String tenantBUser;
    @Value("${snowflake.users.TENANT_B_ANALYST.password}")
    private String tenantBPassword;

    @Value("${snowflake.users.CAPSTONE_SUPPORT.user}")
    private String supportUser;
    @Value("${snowflake.users.CAPSTONE_SUPPORT.password}")
    private String supportPassword;

    @Value("${snowflake.users.POWERBI_TENANT_A.user}")
    private String powerBiAUser;
    @Value("${snowflake.users.POWERBI_TENANT_A.password}")
    private String powerBiAPassword;

    @Value("${snowflake.users.POWERBI_TENANT_B.user}")
    private String powerBiBUser;
    @Value("${snowflake.users.POWERBI_TENANT_B.password}")
    private String powerBiBPassword;

    // -------------------------------------------------------------------------
    // Admin user (ARYAN05) for ACCOUNT_USAGE / health
    // -------------------------------------------------------------------------

    @Value("${snowflake.admin.user}")
    private String adminUser;

    @Value("${snowflake.admin.password}")
    private String adminPassword;

    // Per-credit price (USD) for the /api/usage cost estimate only.
    @Value("${snowflake.credit.price:2.00}")
    private double creditPrice;

    // -------------------------------------------------------------------------
    // Role → tenant mapping
    // -------------------------------------------------------------------------

    /**
     * Returns the tenant identifier for the given role.
     *
     * @throws IllegalArgumentException if the role is not recognised
     */
    public String tenantForRole(String role) {
        if (role == null) throw new IllegalArgumentException("Role must not be null");
        switch (role.toUpperCase()) {
            case "TENANT_A_ANALYST":
            case "POWERBI_TENANT_A":
                return "STEAM";
            case "TENANT_B_ANALYST":
            case "POWERBI_TENANT_B":
                return "EA";
            case "CAPSTONE_SUPPORT":
            case "CAPSTONE_ADMIN":
                return null; // cross-tenant roles have no single tenant
            default:
                throw new IllegalArgumentException("Unknown role: " + role);
        }
    }

    // -------------------------------------------------------------------------
    // Tenant resolution for data calls (analyst / support / admin)
    // -------------------------------------------------------------------------

    /**
     * Active grant tenants for the caller on this support connection, from
     * V_SUPPORT_LOG (already filtered to CURRENT_USER()). A revoked grant
     * has REVOKED_AT set and is never active.
     */
    private List<String> activeGrantTenants(Connection conn) throws SQLException {
        String sql = "SELECT granted_tenant FROM ANALYTICS.V_SUPPORT_LOG "
                   + "WHERE expiry > CURRENT_TIMESTAMP() AND revoked_at IS NULL";
        List<String> grants = new ArrayList<>();
        try (PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            while (rs.next()) {
                grants.add(rs.getString("GRANTED_TENANT"));
            }
        }
        return grants;
    }

    private boolean grantCovers(List<String> grants, String tenant) {
        return grants.contains("ALL") || grants.contains(tenant.toUpperCase());
    }

    /**
     * Resolves which tenant a data call may touch, and enforces it.
     * Analysts are bound to their own tenant. Support is bound to whatever
     * an active, unexpired grant covers. Admin may name any tenant.
     * A null requested tenant means "derive it": analysts get their own,
     * support gets the single active grant's tenant (an error when there is
     * not exactly one specific grant).
     *
     * @throws AccessDeniedException when the caller may not touch the tenant
     */
    private String resolveTenant(Connection conn, String role, String requestedTenant)
            throws SQLException {
        if ("CAPSTONE_SUPPORT".equalsIgnoreCase(role)) {
            List<String> grants = activeGrantTenants(conn);
            if (requestedTenant != null) {
                if (!grantCovers(grants, requestedTenant)) {
                    throw new AccessDeniedException(
                            "No active support grant covers tenant " + requestedTenant
                            + " — request access first");
                }
                return requestedTenant.toUpperCase();
            }
            if (grants.isEmpty()) {
                throw new AccessDeniedException(
                        "No active support grant — request access first");
            }
            List<String> specific = new ArrayList<>();
            for (String g : grants) {
                if (!"ALL".equalsIgnoreCase(g)) specific.add(g);
            }
            if (specific.size() == 1 && grants.size() == 1) {
                return specific.get(0);
            }
            throw new IllegalArgumentException(
                    "Support access covers more than one tenant — name the tenant to view");
        }
        if ("CAPSTONE_ADMIN".equalsIgnoreCase(role)) {
            if (requestedTenant == null) {
                throw new IllegalArgumentException("Tenant is required");
            }
            return requestedTenant.toUpperCase();
        }
        String own = tenantForRole(role);
        if (requestedTenant != null && !own.equalsIgnoreCase(requestedTenant)) {
            throw new AccessDeniedException(
                    "Role " + role + " is not allowed to access tenant " + requestedTenant);
        }
        return own;
    }

    // -------------------------------------------------------------------------
    // Internal connection helpers
    // -------------------------------------------------------------------------

    /**
     * Opens a JDBC connection using the credentials that belong to {@code role},
     * then immediately sets USE ROLE, USE SECONDARY ROLES NONE and the query tag.
     */
    private Connection connect(String role) throws SQLException {
        LAST_QUERY_ID.remove();
        String[] creds = credentialsForRole(role);
        String roleUser     = creds[0];
        String rolePassword = creds[1];

        log.debug("Opening Snowflake connection: user={} role={}", roleUser, role);

        String url = buildUrl();
        Properties props = new Properties();
        props.put("user",     roleUser);
        props.put("password", rolePassword);

        Connection conn = DriverManager.getConnection(url, props);
        try {
            conn.createStatement().execute("USE ROLE " + role);
            conn.createStatement().execute("USE SECONDARY ROLES NONE");

            String tenant = tenantForRole(role);
            String tag = String.format("tenant=%s,role=%s,workload=api",
                    tenant != null ? tenant : "MULTI", role);
            conn.createStatement().execute(
                    "ALTER SESSION SET QUERY_TAG = '" + tag + "'");

            log.debug("Session configured: role={} tag={}", role, tag);
        } catch (SQLException e) {
            conn.close();
            throw e;
        }
        return conn;
    }

    /**
     * Opens a JDBC connection as the admin user (ARYAN05) with CAPSTONE_ADMIN role
     * for ACCOUNT_USAGE queries and connectivity checks.
     */
    private Connection connectAdmin() throws SQLException {
        LAST_QUERY_ID.remove();
        log.debug("Opening Snowflake ADMIN connection: user={}", adminUser);
        String url = buildUrl();
        Properties props = new Properties();
        props.put("user",     adminUser);
        props.put("password", adminPassword);

        Connection conn = DriverManager.getConnection(url, props);
        try {
            conn.createStatement().execute("USE ROLE CAPSTONE_ADMIN");
            conn.createStatement().execute("USE SECONDARY ROLES NONE");
            conn.createStatement().execute(
                    "ALTER SESSION SET QUERY_TAG = 'tenant=MULTI,role=CAPSTONE_ADMIN,workload=admin'");
        } catch (SQLException e) {
            // If CAPSTONE_ADMIN role doesn't exist, fall back gracefully
            log.warn("Could not set CAPSTONE_ADMIN role ({}), continuing with default role", e.getMessage());
        }
        return conn;
    }

    private String buildUrl() {
        return "jdbc:snowflake://" + account
                + "/?warehouse=" + warehouse
                + "&db=" + database
                + "&schema=" + schema;
    }

    /**
     * Returns the [user, password] pair for the given role.
     *
     * @throws IllegalArgumentException for unknown roles
     */
    private String[] credentialsForRole(String role) {
        if (role == null) throw new IllegalArgumentException("Role must not be null");
        switch (role.toUpperCase()) {
            case "TENANT_A_ANALYST":  return new String[]{tenantAUser,   tenantAPassword};
            case "TENANT_B_ANALYST":  return new String[]{tenantBUser,   tenantBPassword};
            case "CAPSTONE_SUPPORT":  return new String[]{supportUser,   supportPassword};
            case "POWERBI_TENANT_A":  return new String[]{powerBiAUser,  powerBiAPassword};
            case "POWERBI_TENANT_B":  return new String[]{powerBiBUser,  powerBiBPassword};
            default:
                throw new IllegalArgumentException("No credentials configured for role: " + role);
        }
    }

    /**
     * Wraps a {@link SQLException}: if the SQLState indicates insufficient
     * privileges (42501) an {@link AccessDeniedException} is thrown; otherwise
     * the original exception is re-thrown.
     */
    private void handleSqlException(SQLException e) throws SQLException {
        log.error("SQLException state={} msg={}", e.getSQLState(), e.getMessage());
        if (e.getSQLState() != null && e.getSQLState().startsWith("42501")) {
            throw new AccessDeniedException(
                    "Access denied by Snowflake: " + e.getMessage(), e);
        }
        throw e;
    }

    // -------------------------------------------------------------------------
    // Public data-access methods
    // -------------------------------------------------------------------------

    public Map<String, Object> getKpis(String role) throws SQLException {
        return getKpis(role, null);
    }

    public Map<String, Object> getKpis(String role, String requestedTenant) throws SQLException {
        String sql = "SELECT TENANT_ID, TOTAL_ORDERS, TOTAL_CUSTOMERS, "
                   + "TOTAL_REVENUE, AVG_ORDER_VALUE "
                   + "FROM ANALYTICS.V_KPIS WHERE TENANT_ID = ?";
        try (Connection conn = connect(role)) {
            String tenant = resolveTenant(conn, role, requestedTenant);
            log.debug("getKpis role={} tenant={}", role, tenant);
            try (PreparedStatement stmt = conn.prepareStatement(sql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    captureQueryId(stmt);
                    if (rs.next()) {
                        Map<String, Object> kpis = new LinkedHashMap<>();
                        kpis.put("tenantId",       rs.getString("TENANT_ID"));
                        kpis.put("totalOrders",    rs.getInt("TOTAL_ORDERS"));
                        kpis.put("totalCustomers", rs.getInt("TOTAL_CUSTOMERS"));
                        kpis.put("totalRevenue",   rs.getBigDecimal("TOTAL_REVENUE"));
                        kpis.put("avgOrderValue",  rs.getBigDecimal("AVG_ORDER_VALUE"));
                        return kpis;
                    }
                    return Map.of();
                }
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
    }

    public List<Map<String, Object>> getOrders(String role) throws SQLException {
        return getOrders(role, null);
    }

    public List<Map<String, Object>> getOrders(String role, String requestedTenant) throws SQLException {
        String sql = "SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, SALES_CHANNEL "
                   + "FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = ? "
                   + "ORDER BY ORDER_DATE DESC LIMIT 100";
        try (Connection conn = connect(role)) {
            String tenant = resolveTenant(conn, role, requestedTenant);
            log.debug("getOrders role={} tenant={}", role, tenant);
            try (PreparedStatement stmt = conn.prepareStatement(sql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    captureQueryId(stmt);
                    List<Map<String, Object>> orders = new ArrayList<>();
                    while (rs.next()) {
                        Map<String, Object> order = new LinkedHashMap<>();
                        order.put("orderId",      rs.getString("ORDER_ID"));
                        order.put("customerId",   rs.getString("CUSTOMER_ID"));
                        order.put("orderDate",    rs.getDate("ORDER_DATE").toString());
                        order.put("salesChannel", rs.getString("SALES_CHANNEL"));
                        orders.add(order);
                    }
                    return orders;
                }
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

    public Map<String, Object> getOrder(String role, String orderId) throws SQLException {
        return getOrder(role, null, orderId);
    }

    public Map<String, Object> getOrder(String role, String requestedTenant, String orderId) throws SQLException {
        String orderSql = "SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, SALES_CHANNEL "
                        + "FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = ? AND ORDER_ID = ?";
        // Product name/category come from V_PRODUCT so the UI never shows a
        // bare product ID on its own.
        String linesSql = "SELECT l.ORDER_LINE_ID, l.PRODUCT_ID, p.PRODUCT_NAME, "
                        + "p.CATEGORY, l.QUANTITY, l.UNIT_PRICE, "
                        + "l.DISCOUNT_PCT, l.REVENUE "
                        + "FROM ANALYTICS.V_ORDER_LINE l "
                        + "LEFT JOIN ANALYTICS.V_PRODUCT p "
                        + "  ON p.TENANT_ID = l.TENANT_ID AND p.PRODUCT_ID = l.PRODUCT_ID "
                        + "WHERE l.TENANT_ID = ? AND l.ORDER_ID = ?";
        try (Connection conn = connect(role)) {
            String tenant = resolveTenant(conn, role, requestedTenant);
            log.debug("getOrder role={} tenant={} orderId={}", role, tenant, orderId);
            Map<String, Object> order = new LinkedHashMap<>();
            try (PreparedStatement stmt = conn.prepareStatement(orderSql)) {
                stmt.setString(1, tenant);
                stmt.setString(2, orderId);
                try (ResultSet rs = stmt.executeQuery()) {
                    captureQueryId(stmt);
                    if (!rs.next()) return Map.of();
                    order.put("orderId",      rs.getString("ORDER_ID"));
                    order.put("customerId",   rs.getString("CUSTOMER_ID"));
                    order.put("orderDate",    rs.getDate("ORDER_DATE").toString());
                    order.put("salesChannel", rs.getString("SALES_CHANNEL"));
                }
            }
            try (PreparedStatement stmt = conn.prepareStatement(linesSql)) {
                stmt.setString(1, tenant);
                stmt.setString(2, orderId);
                try (ResultSet rs = stmt.executeQuery()) {
                    List<Map<String, Object>> lines = new ArrayList<>();
                    while (rs.next()) {
                        Map<String, Object> line = new LinkedHashMap<>();
                        line.put("orderLineId", rs.getString("ORDER_LINE_ID"));
                        line.put("productId",   rs.getString("PRODUCT_ID"));
                        line.put("productName", rs.getString("PRODUCT_NAME"));
                        line.put("category",    rs.getString("CATEGORY"));
                        line.put("quantity",    rs.getInt("QUANTITY"));
                        line.put("unitPrice",   rs.getBigDecimal("UNIT_PRICE"));
                        line.put("discountPct", rs.getBigDecimal("DISCOUNT_PCT"));
                        line.put("revenue",     rs.getBigDecimal("REVENUE"));
                        lines.add(line);
                    }
                    order.put("lines", lines);
                }
            }
            return order;
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
    }

    // -------------------------------------------------------------------------
    // Chart data (Dashboard)
    // -------------------------------------------------------------------------

    /**
     * Revenue by month, channel and category, plus top customers and products
     * by revenue, for one tenant. Support sees masked customer names.
     */
    public Map<String, Object> getAnalyticsSummary(String role, String requestedTenant)
            throws SQLException {
        try (Connection conn = connect(role)) {
            String tenant = resolveTenant(conn, role, requestedTenant);
            log.debug("getAnalyticsSummary role={} tenant={}", role, tenant);
            boolean support = "CAPSTONE_SUPPORT".equalsIgnoreCase(role);
            // Support must never see a real customer name, even in a chart.
            String customerNameExpr = support
                    ? "LEFT(c.CUSTOMER_NAME, 1) || '*** [REDACTED PII]'"
                    : "c.CUSTOMER_NAME";
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("tenant", tenant);

            String monthlySql = "SELECT TO_CHAR(DATE_TRUNC('month', o.ORDER_DATE), 'YYYY-MM') AS month, "
                    + "SUM(l.REVENUE) AS revenue, COUNT(DISTINCT o.ORDER_ID) AS orders "
                    + "FROM ANALYTICS.V_ORDER_LINE l "
                    + "JOIN ANALYTICS.V_ORDERS o ON o.TENANT_ID = l.TENANT_ID AND o.ORDER_ID = l.ORDER_ID "
                    + "WHERE l.TENANT_ID = ? "
                    + "GROUP BY DATE_TRUNC('month', o.ORDER_DATE) ORDER BY month";
            try (PreparedStatement stmt = conn.prepareStatement(monthlySql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    captureQueryId(stmt);
                    List<Map<String, Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        rows.add(Map.of(
                                "month", rs.getString("MONTH"),
                                "revenue", rs.getBigDecimal("REVENUE"),
                                "orders", rs.getInt("ORDERS")));
                    }
                    out.put("monthly", rows);
                }
            }

            String channelSql = "SELECT o.SALES_CHANNEL AS channel, SUM(l.REVENUE) AS revenue, "
                    + "COUNT(DISTINCT o.ORDER_ID) AS orders "
                    + "FROM ANALYTICS.V_ORDER_LINE l "
                    + "JOIN ANALYTICS.V_ORDERS o ON o.TENANT_ID = l.TENANT_ID AND o.ORDER_ID = l.ORDER_ID "
                    + "WHERE l.TENANT_ID = ? GROUP BY o.SALES_CHANNEL ORDER BY revenue DESC";
            try (PreparedStatement stmt = conn.prepareStatement(channelSql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    List<Map<String, Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        rows.add(Map.of(
                                "channel", rs.getString("CHANNEL"),
                                "revenue", rs.getBigDecimal("REVENUE"),
                                "orders", rs.getInt("ORDERS")));
                    }
                    out.put("byChannel", rows);
                }
            }

            String categorySql = "SELECT p.CATEGORY AS category, SUM(l.REVENUE) AS revenue, "
                    + "SUM(l.QUANTITY) AS units "
                    + "FROM ANALYTICS.V_ORDER_LINE l "
                    + "JOIN ANALYTICS.V_PRODUCT p ON p.TENANT_ID = l.TENANT_ID AND p.PRODUCT_ID = l.PRODUCT_ID "
                    + "WHERE l.TENANT_ID = ? GROUP BY p.CATEGORY ORDER BY revenue DESC";
            try (PreparedStatement stmt = conn.prepareStatement(categorySql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    List<Map<String, Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        rows.add(Map.of(
                                "category", rs.getString("CATEGORY"),
                                "revenue", rs.getBigDecimal("REVENUE"),
                                "units", rs.getInt("UNITS")));
                    }
                    out.put("byCategory", rows);
                }
            }

            String topCustomersSql = "SELECT c.CUSTOMER_ID AS customer_id, "
                    + customerNameExpr + " AS customer_name, "
                    + "SUM(l.REVENUE) AS revenue, COUNT(DISTINCT l.ORDER_ID) AS orders "
                    + "FROM ANALYTICS.V_ORDER_LINE l "
                    + "JOIN ANALYTICS.V_ORDERS o ON o.TENANT_ID = l.TENANT_ID AND o.ORDER_ID = l.ORDER_ID "
                    + "JOIN ANALYTICS.V_CUSTOMER c ON c.TENANT_ID = o.TENANT_ID AND c.CUSTOMER_ID = o.CUSTOMER_ID "
                    + "WHERE l.TENANT_ID = ? "
                    + "GROUP BY c.CUSTOMER_ID, c.CUSTOMER_NAME ORDER BY revenue DESC LIMIT 10";
            try (PreparedStatement stmt = conn.prepareStatement(topCustomersSql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    List<Map<String, Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        rows.add(Map.of(
                                "customerId", rs.getString("CUSTOMER_ID"),
                                "customerName", rs.getString("CUSTOMER_NAME"),
                                "revenue", rs.getBigDecimal("REVENUE"),
                                "orders", rs.getInt("ORDERS")));
                    }
                    out.put("topCustomers", rows);
                }
            }

            String topProductsSql = "SELECT p.PRODUCT_ID AS product_id, p.PRODUCT_NAME AS product_name, "
                    + "p.CATEGORY AS category, SUM(l.REVENUE) AS revenue, SUM(l.QUANTITY) AS units "
                    + "FROM ANALYTICS.V_ORDER_LINE l "
                    + "JOIN ANALYTICS.V_PRODUCT p ON p.TENANT_ID = l.TENANT_ID AND p.PRODUCT_ID = l.PRODUCT_ID "
                    + "WHERE l.TENANT_ID = ? "
                    + "GROUP BY p.PRODUCT_ID, p.PRODUCT_NAME, p.CATEGORY ORDER BY revenue DESC LIMIT 10";
            try (PreparedStatement stmt = conn.prepareStatement(topProductsSql)) {
                stmt.setString(1, tenant);
                try (ResultSet rs = stmt.executeQuery()) {
                    List<Map<String, Object>> rows = new ArrayList<>();
                    while (rs.next()) {
                        rows.add(Map.of(
                                "productId", rs.getString("PRODUCT_ID"),
                                "productName", rs.getString("PRODUCT_NAME"),
                                "category", rs.getString("CATEGORY"),
                                "revenue", rs.getBigDecimal("REVENUE"),
                                "units", rs.getInt("UNITS")));
                    }
                    out.put("topProducts", rows);
                }
            }
            return out;
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
    }

    // -------------------------------------------------------------------------
    // Support break-glass
    // -------------------------------------------------------------------------

    /**
     * Calls the support-grant stored procedure as SUPPORT_USER.
     *
     * @return the procedure result message/value
     */
    public Object callSupportGrant(String reason, String tenant, int durationMinutes)
            throws SQLException {
        String sql = "CALL CAPSTONE_DB.TENANT_DATA.SP_SUPPORT_GRANT(?, ?, ?)";
        log.debug("callSupportGrant tenant={} durationMinutes={}", tenant, durationMinutes);
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             CallableStatement cs = conn.prepareCall(sql)) {
            cs.setString(1, reason);
            cs.setString(2, tenant);
            cs.setInt(3, durationMinutes);
            boolean hasRs = cs.execute();
            captureQueryId(cs);
            if (hasRs) {
                try (ResultSet rs = cs.getResultSet()) {
                    if (rs != null && rs.next()) {
                        return rs.getObject(1);
                    }
                }
            }
            return Map.of("result", "Procedure executed successfully");
        } catch (SQLException e) {
            handleSqlException(e);
            return null; // unreachable
        }
    }

    /**
     * Returns the last 5 support-access log entries for the current user.
     */
    public List<Map<String, Object>> getSupportStatus() throws SQLException {
        // Read through ANALYTICS.V_SUPPORT_LOG: CAPSTONE_SUPPORT has no SELECT
        // on TENANT_DATA, and the view already filters to CURRENT_USER().
        String sql = "SELECT log_id, accessed_by, tenant_id, granted_tenant, reason, "
                   + "expiry, duration_minutes, accessed_at, revoked_at, "
                   + "(expiry > CURRENT_TIMESTAMP()) AS is_active "
                   + "FROM ANALYTICS.V_SUPPORT_LOG "
                   + "ORDER BY log_id DESC LIMIT 5";
        log.debug("getSupportStatus");
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            captureQueryId(stmt);
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                rows.add(supportLogRow(rs));
            }
            return rows;
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

    /**
     * Calls the support-revoke stored procedure as SUPPORT_USER, ending the
     * caller's active grants now.
     */
    public Object callSupportRevoke() throws SQLException {
        String sql = "CALL CAPSTONE_DB.TENANT_DATA.SP_SUPPORT_REVOKE()";
        log.debug("callSupportRevoke");
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             CallableStatement cs = conn.prepareCall(sql)) {
            boolean hasRs = cs.execute();
            captureQueryId(cs);
            if (hasRs) {
                try (ResultSet rs = cs.getResultSet()) {
                    if (rs != null && rs.next()) {
                        return rs.getObject(1);
                    }
                }
            }
            return Map.of("result", "Procedure executed successfully");
        } catch (SQLException e) {
            handleSqlException(e);
            return null; // unreachable
        }
    }

    /**
     * Full access history for the caller (support: own rows via
     * V_SUPPORT_LOG; admin: every row from the base table). Status is
     * computed, never stored: revoked when REVOKED_AT is set, active while
     * unexpired, expired otherwise.
     */
    public List<Map<String, Object>> getSupportHistory(String role) throws SQLException {
        boolean admin = "CAPSTONE_ADMIN".equalsIgnoreCase(role);
        String source = admin
                ? "TENANT_DATA.SUPPORT_ACCESS_LOG"
                : "ANALYTICS.V_SUPPORT_LOG";
        String sql = "SELECT log_id, accessed_by, tenant_id, granted_tenant, reason, "
                   + "expiry, duration_minutes, accessed_at, revoked_at, "
                   + "(expiry > CURRENT_TIMESTAMP()) AS is_active "
                   + "FROM " + source + " ORDER BY log_id DESC LIMIT 50";
        log.debug("getSupportHistory role={}", role);
        try (Connection conn = admin ? connectAdmin() : connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            captureQueryId(stmt);
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = supportLogRow(rs);
                String status = row.get("revokedAt") != null ? "revoked"
                        : (Boolean.TRUE.equals(row.get("isActive")) ? "active" : "expired");
                row.put("status", status);
                rows.add(row);
            }
            return rows;
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

    private Map<String, Object> supportLogRow(ResultSet rs) throws SQLException {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("logId",           rs.getObject("LOG_ID"));
        row.put("accessedBy",      rs.getString("ACCESSED_BY"));
        row.put("tenantId",        rs.getString("TENANT_ID"));
        row.put("grantedTenant",   rs.getString("GRANTED_TENANT"));
        row.put("reason",          rs.getString("REASON"));
        row.put("expiry",          rs.getString("EXPIRY"));
        row.put("durationMinutes", rs.getObject("DURATION_MINUTES"));
        row.put("accessedAt",      rs.getString("ACCESSED_AT"));
        row.put("revokedAt",       rs.getString("REVOKED_AT"));
        row.put("isActive",        rs.getBoolean("IS_ACTIVE"));
        return row;
    }

    /**
     * Returns masked customers visible to support through
     * ANALYTICS.V_SUPPORT_CUSTOMER. The view joins SUPPORT_ACCESS_LOG on
     * CURRENT_USER() and an unexpired grant, so without an active grant this
     * returns 0 rows. Customer names are masked by the view itself.
     */
    public List<Map<String, Object>> getSupportCustomers() throws SQLException {
        String sql = "SELECT tenant_id, customer_id, customer_name, city, region, segment "
                   + "FROM ANALYTICS.V_SUPPORT_CUSTOMER "
                   + "ORDER BY tenant_id, customer_id LIMIT 50";
        log.debug("getSupportCustomers");
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            captureQueryId(stmt);
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("tenantId",     rs.getString("TENANT_ID"));
                row.put("customerId",   rs.getString("CUSTOMER_ID"));
                row.put("customerName", rs.getString("CUSTOMER_NAME"));
                row.put("city",         rs.getString("CITY"));
                row.put("region",       rs.getString("REGION"));
                row.put("segment",      rs.getString("SEGMENT"));
                rows.add(row);
            }
            return rows;
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

    // -------------------------------------------------------------------------
    // Isolation evidence suite (POST /api/evidence/run)
    // -------------------------------------------------------------------------

    /**
     * Runs the negative-test suite server-side as the dedicated Snowflake
     * users and returns one structured result per test, each with its
     * Snowflake query ID. A failed test is reported, never thrown: the suite
     * always returns a result. The support grant tests issue a real 1-minute
     * grant and revoke it inside the same run; when a live grant is already
     * open, those three tests are skipped instead of touching it.
     */
    public Map<String, Object> runEvidenceTests() {
        List<Map<String, Object>> tests = new ArrayList<>();
        int preExistingGrants;
        try {
            preExistingGrants = countActiveSupportGrants();
        } catch (Exception e) {
            preExistingGrants = -1;
        }
        tests.add(testOwnKpis("TENANT_A_ANALYST", "STEAM", "656950.40"));
        tests.add(testCrossTenantCount("TENANT_A_ANALYST", "STEAM", "EA"));
        tests.add(testOwnKpis("TENANT_B_ANALYST", "EA", "854522.10"));
        tests.add(testCrossTenantCount("TENANT_B_ANALYST", "EA", "STEAM"));
        tests.add(testBaseTableDenied("TENANT_A_ANALYST"));
        tests.add(testBaseTableDenied("TENANT_B_ANALYST"));
        tests.add(testSecondaryRolesBlocked());
        if (preExistingGrants != 0) {
            String why = preExistingGrants > 0
                    ? "An active support grant is already open — end it and re-run for the full support suite."
                    : "Could not check for open support grants — support tests skipped.";
            tests.add(evidenceSkipped("support-no-grant", "Support without a grant sees 0 rows", why));
            tests.add(evidenceSkipped("support-with-grant", "Support with a grant sees the tenant and is logged", why));
            tests.add(evidenceSkipped("support-after-revoke", "Support sees 0 rows after the grant ends", why));
        } else {
            tests.add(testSupportWithoutGrant());
            tests.add(testSupportWithGrant());
            tests.add(testSupportAfterRevoke());
        }
        long passed = tests.stream().filter(t -> Boolean.TRUE.equals(t.get("pass"))).count();
        long failed = tests.stream().filter(t -> Boolean.FALSE.equals(t.get("pass"))).count();
        long skipped = tests.stream().filter(t -> t.get("pass") == null).count();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("runAt", Instant.now().toString());
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("total", tests.size());
        summary.put("passed", passed);
        summary.put("failed", failed);
        summary.put("skipped", skipped);
        out.put("summary", summary);
        out.put("tests", tests);
        return out;
    }

    private int countActiveSupportGrants() throws SQLException {
        String sql = "SELECT COUNT(*) AS n FROM ANALYTICS.V_SUPPORT_LOG "
                   + "WHERE expiry > CURRENT_TIMESTAMP() AND revoked_at IS NULL";
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            return rs.next() ? rs.getInt("N") : 0;
        }
    }

    private Map<String, Object> evidenceResult(String id, String name, String expected,
            String actual, Boolean pass, Long rowCount, Integer httpStatus,
            String sqlState, String queryId) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", id);
        r.put("name", name);
        r.put("expected", expected);
        r.put("actual", actual);
        r.put("pass", pass);
        r.put("rowCount", rowCount);
        r.put("httpStatus", httpStatus);
        r.put("sqlState", sqlState);
        r.put("queryId", queryId);
        r.put("timestamp", Instant.now().toString());
        return r;
    }

    private Map<String, Object> evidenceSkipped(String id, String name, String why) {
        return evidenceResult(id, name, "Test runs", "Skipped — " + why,
                null, null, null, null, null);
    }

    private static String trimMsg(String msg) {
        if (msg == null) return "";
        String m = msg.replaceAll("\\s+", " ").trim();
        return m.length() > 200 ? m.substring(0, 200) + "…" : m;
    }

    private Map<String, Object> testOwnKpis(String role, String tenant, String expectedRevenue) {
        String label = "STEAM".equals(tenant) ? "A" : "B";
        String id = "own-kpis-" + label.toLowerCase();
        String name = "Tenant " + label + " reads its own KPIs";
        String sql = "SELECT TENANT_ID, TOTAL_REVENUE FROM ANALYTICS.V_KPIS";
        try (Connection conn = connect(role);
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            String qid = queryIdOf(stmt);
            if (rs.next()) {
                String gotTenant = rs.getString("TENANT_ID");
                String revenue = rs.getBigDecimal("TOTAL_REVENUE").toPlainString();
                boolean pass = tenant.equals(gotTenant)
                        && expectedRevenue.equals(revenue) && !rs.next();
                return evidenceResult(id, name, "1 row, " + tenant + ", revenue " + expectedRevenue,
                        "1 row, " + gotTenant + ", revenue " + revenue, pass, 1L, 200, null, qid);
            }
            return evidenceResult(id, name, "1 row, " + tenant, "0 rows", false, 0L, 200, null, qid);
        } catch (Exception e) {
            return evidenceResult(id, name, "1 row, " + tenant, "Error: " + trimMsg(e.getMessage()),
                    false, null, null, e instanceof SQLException se ? se.getSQLState() : null, null);
        }
    }

    private Map<String, Object> testCrossTenantCount(String role, String ownTenant, String otherTenant) {
        String label = "STEAM".equals(ownTenant) ? "A" : "B";
        String id = "cross-tenant-" + label.toLowerCase();
        String name = "Tenant " + label + " cross-tenant read returns 0 rows";
        String sql = "SELECT COUNT(*) AS n FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = ?";
        try (Connection conn = connect(role);
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, otherTenant);
            try (ResultSet rs = stmt.executeQuery()) {
                String qid = queryIdOf(stmt);
                long n = rs.next() ? rs.getLong("N") : -1;
                return evidenceResult(id, name, "0 rows for " + otherTenant,
                        n + " rows for " + otherTenant, n == 0, n, 200, null, qid);
            }
        } catch (Exception e) {
            return evidenceResult(id, name, "0 rows for " + otherTenant, "Error: " + trimMsg(e.getMessage()),
                    false, null, null, e instanceof SQLException se ? se.getSQLState() : null, null);
        }
    }

    private Map<String, Object> testBaseTableDenied(String role) {
        String label = role.contains("TENANT_A") ? "A" : "B";
        String id = "base-table-denied-" + label.toLowerCase();
        String name = "Tenant " + label + " base-table read is denied";
        String sql = "SELECT COUNT(*) FROM TENANT_DATA.CUSTOMER";
        PreparedStatement stmt = null;
        try (Connection conn = connect(role)) {
            stmt = conn.prepareStatement(sql);
            try (ResultSet rs = stmt.executeQuery()) {
                long n = rs.next() ? rs.getLong(1) : -1;
                return evidenceResult(id, name, "Denied (SQLState 42501)",
                        "Read succeeded with " + n + " rows — isolation broken",
                        false, n, 200, null, queryIdOf(stmt));
            }
        } catch (SQLException e) {
            String qid = stmt != null ? queryIdOf(stmt) : null;
            boolean denied = e.getSQLState() != null && e.getSQLState().startsWith("42501");
            return evidenceResult(id, name, "Denied (SQLState 42501)",
                    denied ? "Denied: " + trimMsg(e.getMessage())
                            : "Unexpected error: " + trimMsg(e.getMessage()),
                    denied, null, denied ? 403 : 500, e.getSQLState(), qid);
        } catch (Exception e) {
            return evidenceResult(id, name, "Denied (SQLState 42501)",
                    "Error: " + trimMsg(e.getMessage()), false, null, null, null, null);
        } finally {
            if (stmt != null) {
                try { stmt.close(); } catch (Exception ignored) { /* close quietly */ }
            }
        }
    }

    private Map<String, Object> testSecondaryRolesBlocked() {
        String id = "secondary-roles-blocked";
        String name = "Secondary-role bypass is blocked";
        String crossSql = "SELECT COUNT(*) AS n FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = 'EA'";
        String ownSql = "SELECT COUNT(*) AS n FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = 'STEAM'";
        try (Connection conn = connect("TENANT_A_ANALYST")) {
            conn.createStatement().execute("USE SECONDARY ROLES ALL");
            long cross;
            String qid;
            try (PreparedStatement stmt = conn.prepareStatement(crossSql);
                 ResultSet rs = stmt.executeQuery()) {
                qid = queryIdOf(stmt);
                cross = rs.next() ? rs.getLong("N") : -1;
            }
            long own;
            try (PreparedStatement stmt = conn.prepareStatement(ownSql);
                 ResultSet rs = stmt.executeQuery()) {
                own = rs.next() ? rs.getLong("N") : -1;
            }
            boolean pass = cross == 0 && own == 20;
            return evidenceResult(id, name, "EA 0 rows, STEAM still 20 rows after USE SECONDARY ROLES ALL",
                    "EA " + cross + " rows, STEAM " + own + " rows", pass, cross, 200, null, qid);
        } catch (Exception e) {
            return evidenceResult(id, name, "EA 0 rows, STEAM still 20 rows",
                    "Error: " + trimMsg(e.getMessage()), false, null, null,
                    e instanceof SQLException se ? se.getSQLState() : null, null);
        }
    }

    private Map<String, Object> testSupportWithoutGrant() {
        String id = "support-no-grant";
        String name = "Support without a grant sees 0 rows";
        String sql = "SELECT COUNT(*) AS n FROM ANALYTICS.V_CUSTOMER";
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            String qid = queryIdOf(stmt);
            long n = rs.next() ? rs.getLong("N") : -1;
            return evidenceResult(id, name, "0 rows", n + " rows", n == 0, n, 200, null, qid);
        } catch (Exception e) {
            return evidenceResult(id, name, "0 rows", "Error: " + trimMsg(e.getMessage()),
                    false, null, null, e instanceof SQLException se ? se.getSQLState() : null, null);
        }
    }

    private Map<String, Object> testSupportWithGrant() {
        String id = "support-with-grant";
        String name = "Support with a grant sees the tenant and is logged";
        String reason = "Evidence run: automated isolation test";
        try (Connection conn = connect("CAPSTONE_SUPPORT")) {
            String grantResult;
            try (CallableStatement cs = conn.prepareCall(
                    "CALL CAPSTONE_DB.TENANT_DATA.SP_SUPPORT_GRANT(?, ?, ?)")) {
                cs.setString(1, reason);
                cs.setString(2, "STEAM");
                cs.setInt(3, 1);
                boolean hasRs = cs.execute();
                if (hasRs) {
                    try (ResultSet rs = cs.getResultSet()) {
                        grantResult = (rs != null && rs.next()) ? String.valueOf(rs.getObject(1)) : "";
                    }
                } else {
                    grantResult = "";
                }
            }
            if (grantResult == null || grantResult.startsWith("ERROR:")) {
                return evidenceResult(id, name, "Grant issued, STEAM 20 rows, log row written",
                        "Grant failed: " + trimMsg(grantResult), false, null, 400, null, null);
            }
            long steamRows;
            String qid;
            try (PreparedStatement stmt = conn.prepareStatement(
                    "SELECT COUNT(*) AS n FROM ANALYTICS.V_CUSTOMER WHERE TENANT_ID = 'STEAM'");
                 ResultSet rs = stmt.executeQuery()) {
                qid = queryIdOf(stmt);
                steamRows = rs.next() ? rs.getLong("N") : -1;
            }
            long logRows;
            try (PreparedStatement stmt = conn.prepareStatement(
                    "SELECT COUNT(*) AS n FROM ANALYTICS.V_SUPPORT_LOG "
                    + "WHERE reason = ? AND expiry > CURRENT_TIMESTAMP()")) {
                stmt.setString(1, reason);
                try (ResultSet rs = stmt.executeQuery()) {
                    logRows = rs.next() ? rs.getLong("N") : -1;
                }
            }
            String revokeResult;
            try (CallableStatement cs = conn.prepareCall(
                    "CALL CAPSTONE_DB.TENANT_DATA.SP_SUPPORT_REVOKE()")) {
                boolean hasRs = cs.execute();
                if (hasRs) {
                    try (ResultSet rs = cs.getResultSet()) {
                        revokeResult = (rs != null && rs.next()) ? String.valueOf(rs.getObject(1)) : "";
                    }
                } else {
                    revokeResult = "";
                }
            }
            boolean pass = steamRows == 20 && logRows >= 1
                    && revokeResult != null && revokeResult.startsWith("REVOKED:");
            return evidenceResult(id, name, "Grant issued, STEAM 20 rows, log row written, grant revoked",
                    "STEAM " + steamRows + " rows, log rows " + logRows + ", revoke: " + trimMsg(revokeResult),
                    pass, steamRows, 200, null, qid);
        } catch (Exception e) {
            return evidenceResult(id, name, "Grant issued, STEAM 20 rows, log row written",
                    "Error: " + trimMsg(e.getMessage()), false, null, null,
                    e instanceof SQLException se ? se.getSQLState() : null, null);
        }
    }

    private Map<String, Object> testSupportAfterRevoke() {
        String id = "support-after-revoke";
        String name = "Support sees 0 rows after the grant ends";
        String sql = "SELECT COUNT(*) AS n FROM ANALYTICS.V_CUSTOMER";
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            String qid = queryIdOf(stmt);
            long n = rs.next() ? rs.getLong("N") : -1;
            return evidenceResult(id, name, "0 rows", n + " rows", n == 0, n, 200, null, qid);
        } catch (Exception e) {
            return evidenceResult(id, name, "0 rows", "Error: " + trimMsg(e.getMessage()),
                    false, null, null, e instanceof SQLException se ? se.getSQLState() : null, null);
        }
    }

    // -------------------------------------------------------------------------
    // Usage / admin
    // -------------------------------------------------------------------------

    /**
     * Returns aggregated query usage from ACCOUNT_USAGE over the last 7 days.
     * Note: ACCOUNT_USAGE may lag 45 min – 3 h.
     */
    public Map<String, Object> getUsageStats() throws SQLException {
        String usageSql = "SELECT ROLE_NAME, QUERY_TAG, COUNT(*) AS queries, "
                   + "ROUND(SUM(TOTAL_ELAPSED_TIME)/1000.0, 1) AS total_seconds "
                   + "FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY "
                   + "WHERE WAREHOUSE_NAME = 'CAPSTONE_WH' "
                   + "  AND START_TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP()) "
                   + "GROUP BY ROLE_NAME, QUERY_TAG "
                   + "ORDER BY ROLE_NAME, queries DESC "
                   + "LIMIT 50";
        // Metered warehouse credits for the same window. QUERY_HISTORY gives
        // seconds per query; only WAREHOUSE_METERING_HISTORY gives the credits
        // Snowflake actually bills, so cost is split by share of query time.
        String creditsSql = "SELECT COALESCE(SUM(CREDITS_USED), 0) AS credits "
                   + "FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY "
                   + "WHERE WAREHOUSE_NAME = 'CAPSTONE_WH' "
                   + "  AND START_TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP())";
        log.debug("getUsageStats (admin)");
        List<Map<String, Object>> rows = new ArrayList<>();
        double totalCredits = 0;
        try (Connection conn = connectAdmin();
             PreparedStatement usageStmt = conn.prepareStatement(usageSql);
             ResultSet rs = usageStmt.executeQuery()) {
            captureQueryId(usageStmt);
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("roleName",     rs.getString("ROLE_NAME"));
                row.put("queryTag",     rs.getString("QUERY_TAG"));
                row.put("queries",      rs.getLong("QUERIES"));
                row.put("totalSeconds", rs.getDouble("TOTAL_SECONDS"));
                rows.add(row);
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
        try (Connection conn = connectAdmin();
             PreparedStatement creditsStmt = conn.prepareStatement(creditsSql);
             ResultSet rs = creditsStmt.executeQuery()) {
            if (rs.next()) {
                totalCredits = rs.getBigDecimal("CREDITS").doubleValue();
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("usage", rows);
        result.put("cost", buildCostAttribution(rows, totalCredits));
        // Daily metered credits for the same window (credits-over-time chart).
        String dailySql = "SELECT DATE(START_TIME) AS day, SUM(CREDITS_USED) AS credits "
                   + "FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY "
                   + "WHERE WAREHOUSE_NAME = 'CAPSTONE_WH' "
                   + "  AND START_TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP()) "
                   + "GROUP BY DATE(START_TIME) ORDER BY day";
        List<Map<String, Object>> daily = new ArrayList<>();
        try (Connection conn = connectAdmin();
             PreparedStatement dailyStmt = conn.prepareStatement(dailySql);
             ResultSet rs = dailyStmt.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("date", rs.getDate("DAY").toString());
                d.put("credits", round2(rs.getBigDecimal("CREDITS").doubleValue()));
                daily.add(d);
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
        result.put("daily", daily);
        // Resource monitor: CAPSTONE_RM was created in Task 7 with a
        // 10-credit quota. Used credits are the metered total for the window.
        Map<String, Object> rm = new LinkedHashMap<>();
        rm.put("name", "CAPSTONE_RM");
        rm.put("capCredits", 10);
        rm.put("usedCredits", round2(totalCredits));
        rm.put("windowDays", 7);
        rm.put("note", "Used credits are the metered total for the last 7 days; "
                + "the monitor caps the warehouse at 10 credits.");
        result.put("resourceMonitor", rm);
        return result;
    }

    /**
     * Ingestion health from the Task 3 load tables: one row per file loaded,
     * plus every rejected row with its reason.
     */
    public Map<String, Object> getIngestionHealth() throws SQLException {
        String filesSql = "SELECT log_id, file_name, table_name, tenant_id, "
                   + "rows_loaded, rows_rejected, loaded_at, status "
                   + "FROM TENANT_DATA.INGESTION_LOG ORDER BY log_id";
        String errorsSql = "SELECT error_id, file_name, row_text, error_text, logged_at "
                   + "FROM TENANT_DATA.INGESTION_ERRORS ORDER BY error_id";
        log.debug("getIngestionHealth (admin)");
        List<Map<String, Object>> files = new ArrayList<>();
        List<Map<String, Object>> errors = new ArrayList<>();
        long loaded = 0;
        long rejected = 0;
        try (Connection conn = connectAdmin();
             PreparedStatement filesStmt = conn.prepareStatement(filesSql);
             ResultSet rs = filesStmt.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> f = new LinkedHashMap<>();
                f.put("logId",        rs.getObject("LOG_ID"));
                f.put("fileName",     rs.getString("FILE_NAME"));
                f.put("tableName",    rs.getString("TABLE_NAME"));
                f.put("tenantId",     rs.getString("TENANT_ID"));
                f.put("rowsLoaded",   rs.getLong("ROWS_LOADED"));
                f.put("rowsRejected", rs.getLong("ROWS_REJECTED"));
                f.put("loadedAt",     rs.getString("LOADED_AT"));
                f.put("status",       rs.getString("STATUS"));
                loaded += rs.getLong("ROWS_LOADED");
                rejected += rs.getLong("ROWS_REJECTED");
                files.add(f);
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
        try (Connection conn = connectAdmin();
             PreparedStatement errorsStmt = conn.prepareStatement(errorsSql);
             ResultSet rs = errorsStmt.executeQuery()) {
            while (rs.next()) {
                Map<String, Object> er = new LinkedHashMap<>();
                er.put("errorId",   rs.getObject("ERROR_ID"));
                er.put("fileName",  rs.getString("FILE_NAME"));
                er.put("rowText",   rs.getString("ROW_TEXT"));
                er.put("errorText", rs.getString("ERROR_TEXT"));
                er.put("loggedAt",  rs.getString("LOGGED_AT"));
                errors.add(er);
            }
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("files", files);
        out.put("errors", errors);
        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("filesLoaded", files.size());
        totals.put("rowsLoaded", loaded);
        totals.put("rowsRejected", rejected);
        out.put("totals", totals);
        return out;
    }

    /**
     * Warehouse state for the health endpoint (name, state, size).
     */
    public Map<String, Object> getWarehouseState() {
        try (Connection conn = connectAdmin();
             PreparedStatement stmt = conn.prepareStatement("SHOW WAREHOUSES LIKE 'CAPSTONE_WH'");
             ResultSet rs = stmt.executeQuery()) {
            if (rs.next()) {
                Map<String, Object> wh = new LinkedHashMap<>();
                wh.put("name", rs.getString("NAME"));
                wh.put("state", rs.getString("STATE"));
                wh.put("size", rs.getString("SIZE"));
                return wh;
            }
        } catch (Exception e) {
            log.warn("Warehouse state check failed: {}", e.getMessage());
        }
        Map<String, Object> wh = new LinkedHashMap<>();
        wh.put("name", "CAPSTONE_WH");
        wh.put("state", "UNKNOWN");
        wh.put("size", "");
        return wh;
    }

    /**
     * Splits the warehouse's metered credits across tenants by each tenant's
     * share of tagged query time. STEAM/EA come from the API query tags;
     * SHARED is platform/admin work (tenant=MULTI) and UNTAGGED is work with
     * no query tag (Snowsight, test runners), shown so the split reconciles.
     * Cost is an estimate at the configured per-credit price.
     */
    private Map<String, Object> buildCostAttribution(List<Map<String, Object>> rows, double totalCredits) {
        Map<String, double[]> buckets = new LinkedHashMap<>();
        double totalSeconds = 0;
        for (Map<String, Object> row : rows) {
            String tag = (String) row.get("queryTag");
            String bucket = "UNTAGGED";
            if (tag != null) {
                for (String part : tag.split(",")) {
                    String[] kv = part.split("=", 2);
                    if (kv.length == 2 && "tenant".equalsIgnoreCase(kv[0].trim())) {
                        String t = kv[1].trim().toUpperCase();
                        bucket = ("STEAM".equals(t) || "EA".equals(t)) ? t
                                : ("MULTI".equals(t) ? "SHARED" : "UNTAGGED");
                        break;
                    }
                }
            }
            double[] acc = buckets.computeIfAbsent(bucket, k -> new double[2]);
            acc[0] += ((Number) row.get("queries")).longValue();
            acc[1] += ((Number) row.get("totalSeconds")).doubleValue();
            totalSeconds += ((Number) row.get("totalSeconds")).doubleValue();
        }
        List<Map<String, Object>> tenants = new ArrayList<>();
        for (Map.Entry<String, double[]> e : buckets.entrySet()) {
            double share = totalSeconds > 0 ? e.getValue()[1] / totalSeconds : 0;
            double credits = totalCredits * share;
            Map<String, Object> b = new LinkedHashMap<>();
            b.put("tenant", e.getKey());
            b.put("queries", (long) e.getValue()[0]);
            b.put("seconds", round1(e.getValue()[1]));
            b.put("sharePct", round1(share * 100));
            b.put("credits", round2(credits));
            b.put("estimatedCostUsd", round2(credits * creditPrice));
            tenants.add(b);
        }
        tenants.sort((a, b) -> Double.compare((Double) b.get("seconds"), (Double) a.get("seconds")));
        Map<String, Object> cost = new LinkedHashMap<>();
        cost.put("totalCredits", round2(totalCredits));
        cost.put("pricePerCreditUsd", creditPrice);
        cost.put("currency", "USD");
        cost.put("windowDays", 7);
        cost.put("tenants", tenants);
        cost.put("method", "Warehouse credits come from WAREHOUSE_METERING_HISTORY (what Snowflake bills). "
                + "Each tenant's share is its share of tagged query time in QUERY_HISTORY; "
                + "SHARED is platform/admin work and UNTAGGED is work without a query tag. "
                + "Cost is an estimate at the configured per-credit price.");
        return cost;
    }

    private static double round1(double v) { return Math.round(v * 10) / 10.0; }
    private static double round2(double v) { return Math.round(v * 100) / 100.0; }

    // -------------------------------------------------------------------------
    // Health / connectivity
    // -------------------------------------------------------------------------

    /**
     * Quick connectivity test: connects as TENANT_A_USER with TENANT_A_ANALYST role
     * and runs {@code SELECT 1}.
     *
     * @return {@code true} if the round-trip succeeds
     */
    public boolean testConnectivity() {
        try (Connection conn = connect("TENANT_A_ANALYST");
             PreparedStatement stmt = conn.prepareStatement("SELECT 1")) {
            stmt.executeQuery();
            return true;
        } catch (Exception e) {
            log.warn("Health check failed: {}", e.getMessage());
            return false;
        }
    }
}
