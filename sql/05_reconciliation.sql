-- =============================================================================
-- FILE: 05_reconciliation.sql
-- PROJECT: Capstone - CAP-30 Tenant Isolation
-- PURPOSE: Comprehensive data profiling, KPI derivation, and financial reconciliation.
-- RUN AS:  ACCOUNTADMIN or CAPSTONE_ADMIN
-- =============================================================================

USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CAPSTONE_WH;
USE DATABASE CAPSTONE_DB;

-- ---------------------------------------------------------------------------
-- 1. BASE TABLE COUNTS VS INGESTION SPECIFICATION
-- ---------------------------------------------------------------------------
SELECT 
    'TENANT' AS table_name, 
    COUNT(*) AS actual_count, 
    2 AS expected_count, 
    (COUNT(*) = 2) AS passed 
FROM TENANT_DATA.TENANT
UNION ALL
SELECT 'CUSTOMER', COUNT(*), 40, (COUNT(*) = 40) FROM TENANT_DATA.CUSTOMER
UNION ALL
SELECT 'PRODUCT', COUNT(*), 24, (COUNT(*) = 24) FROM TENANT_DATA.PRODUCT
UNION ALL
SELECT 'ORDERS', COUNT(*), 400, (COUNT(*) = 400) FROM TENANT_DATA.ORDERS
UNION ALL
SELECT 'ORDER_LINE', COUNT(*), 837, (COUNT(*) = 837) FROM TENANT_DATA.ORDER_LINE;

-- ---------------------------------------------------------------------------
-- 2. REVENUE FORMULA RECONCILIATION
-- Mathematical definition: revenue = ROUND(quantity * unit_price * (1 - discount_pct/100), 2)
-- ---------------------------------------------------------------------------
SELECT 
    tenant_id,
    ROUND(SUM(quantity * unit_price * (1 - discount_pct / 100)), 2) AS calculated_revenue,
    ROUND(SUM(revenue), 2) AS stored_revenue,
    ROUND(SUM(revenue) - SUM(quantity * unit_price * (1 - discount_pct / 100)), 2) AS variance,
    (ABS(ROUND(SUM(revenue) - SUM(quantity * unit_price * (1 - discount_pct / 100)), 2)) < 0.01) AS passed
FROM TENANT_DATA.ORDER_LINE
GROUP BY tenant_id
ORDER BY tenant_id;

-- ---------------------------------------------------------------------------
-- 3. CROSS-CHECK KPI TOTALS ACROSS VIEWS & BASE TABLES
-- Total Revenue STEAM: 656,950.40
-- Total Revenue EA:    854,522.10
-- Grand Total:       1,511,472.50
-- ---------------------------------------------------------------------------
SELECT 
    l.tenant_id,
    COUNT(DISTINCT l.order_id) AS distinct_orders,
    COUNT(DISTINCT o.customer_id) AS distinct_customers,
    ROUND(SUM(l.revenue), 2) AS total_revenue,
    ROUND(SUM(l.revenue) / COUNT(DISTINCT l.order_id), 2) AS avg_order_value
FROM TENANT_DATA.ORDER_LINE l
JOIN TENANT_DATA.ORDERS o 
  ON l.tenant_id = o.tenant_id AND l.order_id = o.order_id
GROUP BY l.tenant_id
ORDER BY l.tenant_id;

-- ---------------------------------------------------------------------------
-- 4. REFERENTIAL INTEGRITY & ORPHAN CHECKS
-- ---------------------------------------------------------------------------
-- Orphan orders without valid customer
SELECT 'Orphan Orders (No Customer)' AS check_name, COUNT(*) AS orphan_count, (COUNT(*) = 0) AS passed
FROM TENANT_DATA.ORDERS o
LEFT JOIN TENANT_DATA.CUSTOMER c
  ON o.tenant_id = c.tenant_id AND o.customer_id = c.customer_id
WHERE c.customer_id IS NULL

UNION ALL

-- Orphan order lines without valid order
SELECT 'Orphan Lines (No Order)', COUNT(*), (COUNT(*) = 0)
FROM TENANT_DATA.ORDER_LINE l
LEFT JOIN TENANT_DATA.ORDERS o
  ON l.tenant_id = o.tenant_id AND l.order_id = o.order_id
WHERE o.order_id IS NULL

UNION ALL

-- Orphan order lines without valid product
SELECT 'Orphan Lines (No Product)', COUNT(*), (COUNT(*) = 0)
FROM TENANT_DATA.ORDER_LINE l
LEFT JOIN TENANT_DATA.PRODUCT p
  ON l.tenant_id = p.tenant_id AND l.product_id = p.product_id
WHERE p.product_id IS NULL;

-- ---------------------------------------------------------------------------
-- 5. ROLE TENANT MAP INTEGRITY & FAIL-CLOSED VERIFICATION
-- ---------------------------------------------------------------------------
SELECT role_name, tenant_id, note FROM TENANT_DATA.ROLE_TENANT_MAP ORDER BY role_name;
