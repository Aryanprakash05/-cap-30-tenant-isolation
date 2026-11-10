package com.capstone.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

@Service
public class SnowflakeService {

    @Value("${snowflake.account}")
    private String account;

    @Value("${snowflake.warehouse}")
    private String warehouse;

    @Value("${snowflake.database}")
    private String database;

    @Value("${snowflake.schema}")
    private String schema;

    @Value("${snowflake.user}")
    private String user;

    @Value("${snowflake.password}")
    private String password;

    public String tenantForRole(String role) {
        if ("TENANT_A_ANALYST".equalsIgnoreCase(role)) {
            return "STEAM";
        }
        if ("TENANT_B_ANALYST".equalsIgnoreCase(role)) {
            return "EA";
        }
        throw new IllegalArgumentException("Unknown role: " + role);
    }

    private Connection connect(String role) throws SQLException {
        String url = "jdbc:snowflake://" + account + "/?warehouse=" + warehouse
                + "&db=" + database + "&schema=" + schema + "&role=" + role;
        Properties props = new Properties();
        props.put("user", user);
        props.put("password", password);
        Connection conn = DriverManager.getConnection(url, props);
        conn.createStatement().execute("USE SECONDARY ROLES NONE");
        return conn;
    }

    public Map<String, Object> getKpis(String role) throws SQLException {
        String tenant = tenantForRole(role);
        String sql = "SELECT TENANT_ID, TOTAL_ORDERS, TOTAL_CUSTOMERS, TOTAL_REVENUE, AVG_ORDER_VALUE FROM ANALYTICS.V_KPIS WHERE TENANT_ID = ?";
        try (Connection conn = connect(role);
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, tenant);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    Map<String, Object> kpis = new LinkedHashMap<>();
                    kpis.put("tenantId", rs.getString("TENANT_ID"));
                    kpis.put("totalOrders", rs.getInt("TOTAL_ORDERS"));
                    kpis.put("totalCustomers", rs.getInt("TOTAL_CUSTOMERS"));
                    kpis.put("totalRevenue", rs.getBigDecimal("TOTAL_REVENUE"));
                    kpis.put("avgOrderValue", rs.getBigDecimal("AVG_ORDER_VALUE"));
                    return kpis;
                }
                return Map.of();
            }
        }
    }

    public List<Map<String, Object>> getOrders(String role) throws SQLException {
        String tenant = tenantForRole(role);
        String sql = "SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, SALES_CHANNEL FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = ? ORDER BY ORDER_DATE DESC LIMIT 100";
        try (Connection conn = connect(role);
             PreparedStatement stmt = conn.prepareStatement(sql)) {
            stmt.setString(1, tenant);
            try (ResultSet rs = stmt.executeQuery()) {
                List<Map<String, Object>> orders = new ArrayList<>();
                while (rs.next()) {
                    Map<String, Object> order = new LinkedHashMap<>();
                    order.put("orderId", rs.getString("ORDER_ID"));
                    order.put("customerId", rs.getString("CUSTOMER_ID"));
                    order.put("orderDate", rs.getDate("ORDER_DATE").toString());
                    order.put("salesChannel", rs.getString("SALES_CHANNEL"));
                    orders.add(order);
                }
                return orders;
            }
        }
    }

    public Map<String, Object> getOrder(String role, String orderId) throws SQLException {
        String tenant = tenantForRole(role);
        String orderSql = "SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, SALES_CHANNEL FROM ANALYTICS.V_ORDERS WHERE TENANT_ID = ? AND ORDER_ID = ?";
        String linesSql = "SELECT ORDER_LINE_ID, PRODUCT_ID, QUANTITY, UNIT_PRICE, DISCOUNT_PCT, REVENUE FROM ANALYTICS.V_ORDER_LINE WHERE TENANT_ID = ? AND ORDER_ID = ?";
        try (Connection conn = connect(role)) {
            Map<String, Object> order = new LinkedHashMap<>();
            try (PreparedStatement stmt = conn.prepareStatement(orderSql)) {
                stmt.setString(1, tenant);
                stmt.setString(2, orderId);
                try (ResultSet rs = stmt.executeQuery()) {
                    if (!rs.next()) {
                        return Map.of();
                    }
                    order.put("orderId", rs.getString("ORDER_ID"));
                    order.put("customerId", rs.getString("CUSTOMER_ID"));
                    order.put("orderDate", rs.getDate("ORDER_DATE").toString());
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
                        line.put("productId", rs.getString("PRODUCT_ID"));
                        line.put("quantity", rs.getInt("QUANTITY"));
                        line.put("unitPrice", rs.getBigDecimal("UNIT_PRICE"));
                        line.put("discountPct", rs.getBigDecimal("DISCOUNT_PCT"));
                        line.put("revenue", rs.getBigDecimal("REVENUE"));
                        lines.add(line);
                    }
                    order.put("lines", lines);
                }
            }
            return order;
        }
    }
}
