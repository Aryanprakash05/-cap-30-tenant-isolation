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
    // Internal connection helpers
    // -------------------------------------------------------------------------

    /**
     * Opens a JDBC connection using the credentials that belong to {@code role},
     * then immediately sets USE ROLE, USE SECONDARY ROLES NONE and the query tag.
     */
    private Connection connect(String role) throws SQLException {
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
        String tenant = tenantForRole(role);
        String sql = "SELECT TENANT_ID, TOTAL_ORDERS, TOTAL_CUSTOMERS, "
                   + "TOTAL_REVENUE, AVG_ORDER_VALUE "
                   + "FROM ANALYTICS.V_KPIS WHERE TENANT_ID = ?";
        log.debug("getKpis role={} tenant={}", role, tenant);
        try (Connection conn = connect(role);
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, tenant);
            try (ResultSet rs = stmt.executeQuery()) {
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
        } catch (SQLException e) {
            handleSqlException(e);
            return Map.of(); // unreachable
        }
    }

    public List<Map<String, Object>> getOrders(String role) throws SQLException {
        String tenant = tenantForRole(role);
        String sql = "SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, SALES_CHANNEL "
                   + "FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = ? "
                   + "ORDER BY ORDER_DATE DESC LIMIT 100";
        log.debug("getOrders role={} tenant={}", role, tenant);
        try (Connection conn = connect(role);
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, tenant);
            try (ResultSet rs = stmt.executeQuery()) {
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
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

    public Map<String, Object> getOrder(String role, String orderId) throws SQLException {
        String tenant = tenantForRole(role);
        String orderSql = "SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, SALES_CHANNEL "
                        + "FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = ? AND ORDER_ID = ?";
        String linesSql = "SELECT ORDER_LINE_ID, PRODUCT_ID, QUANTITY, UNIT_PRICE, "
                        + "DISCOUNT_PCT, REVENUE "
                        + "FROM ANALYTICS.V_ORDER_LINE WHERE TENANT_ID = ? AND ORDER_ID = ?";
        log.debug("getOrder role={} tenant={} orderId={}", role, tenant, orderId);
        try (Connection conn = connect(role)) {
            Map<String, Object> order = new LinkedHashMap<>();
            try (PreparedStatement stmt = conn.prepareStatement(orderSql)) {
                stmt.setString(1, tenant);
                stmt.setString(2, orderId);
                try (ResultSet rs = stmt.executeQuery()) {
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
        String sql = "SELECT accessed_by, tenant_id, reason, expiry, "
                   + "(expiry > CURRENT_TIMESTAMP()) AS is_active "
                   + "FROM ANALYTICS.V_SUPPORT_LOG "
                   + "ORDER BY log_id DESC LIMIT 5";
        log.debug("getSupportStatus");
        try (Connection conn = connect("CAPSTONE_SUPPORT");
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("accessedBy", rs.getString("accessed_by"));
                row.put("tenantId",   rs.getString("tenant_id"));
                row.put("reason",     rs.getString("reason"));
                row.put("expiry",     rs.getString("expiry"));
                row.put("isActive",   rs.getBoolean("is_active"));
                rows.add(row);
            }
            return rows;
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
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
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("tenantId",     rs.getString("tenant_id"));
                row.put("customerId",   rs.getString("customer_id"));
                row.put("customerName", rs.getString("customer_name"));
                row.put("city",         rs.getString("city"));
                row.put("region",       rs.getString("region"));
                row.put("segment",      rs.getString("segment"));
                rows.add(row);
            }
            return rows;
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

    // -------------------------------------------------------------------------
    // Usage / admin
    // -------------------------------------------------------------------------

    /**
     * Returns aggregated query usage from ACCOUNT_USAGE over the last 7 days.
     * Note: ACCOUNT_USAGE may lag 45 min – 3 h.
     */
    public List<Map<String, Object>> getUsageStats() throws SQLException {
        String sql = "SELECT ROLE_NAME, QUERY_TAG, COUNT(*) AS queries, "
                   + "ROUND(SUM(TOTAL_ELAPSED_TIME)/1000.0, 1) AS total_seconds "
                   + "FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY "
                   + "WHERE WAREHOUSE_NAME = 'CAPSTONE_WH' "
                   + "  AND START_TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP()) "
                   + "GROUP BY ROLE_NAME, QUERY_TAG "
                   + "ORDER BY ROLE_NAME, queries DESC "
                   + "LIMIT 50";
        log.debug("getUsageStats (admin)");
        try (Connection conn = connectAdmin();
             PreparedStatement stmt = conn.prepareStatement(sql);
             ResultSet rs = stmt.executeQuery()) {
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("roleName",     rs.getString("ROLE_NAME"));
                row.put("queryTag",     rs.getString("QUERY_TAG"));
                row.put("queries",      rs.getLong("queries"));
                row.put("totalSeconds", rs.getDouble("total_seconds"));
                rows.add(row);
            }
            return rows;
        } catch (SQLException e) {
            handleSqlException(e);
            return List.of(); // unreachable
        }
    }

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
