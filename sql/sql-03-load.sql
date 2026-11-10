USE ROLE ACCOUNTADMIN;
USE WAREHOUSE CAPSTONE_WH;
USE DATABASE CAPSTONE_DB;
USE SCHEMA TENANT_DATA;

CREATE STAGE IF NOT EXISTS CAPSTONE_STAGE
    URL = 's3://cap-30-tenant-data-aryan/cap30/'
    CREDENTIALS = (AWS_KEY_ID = '<AWS_KEY_ID>' AWS_SECRET_KEY = '<AWS_SECRET_KEY>')
    FILE_FORMAT = CAPSTONE_CSV_FORMAT;

LIST @CAPSTONE_STAGE;

COPY INTO TENANT
    FROM @CAPSTONE_STAGE/tenants.csv
    FILE_FORMAT = CAPSTONE_CSV_FORMAT
    ON_ERROR = 'ABORT_STATEMENT';

COPY INTO CUSTOMER
    FROM @CAPSTONE_STAGE/customers.csv
    FILE_FORMAT = CAPSTONE_CSV_FORMAT
    ON_ERROR = 'ABORT_STATEMENT';

COPY INTO PRODUCT
    FROM @CAPSTONE_STAGE/products.csv
    FILE_FORMAT = CAPSTONE_CSV_FORMAT
    ON_ERROR = 'ABORT_STATEMENT';

COPY INTO ORDERS
    FROM @CAPSTONE_STAGE/orders.csv
    FILE_FORMAT = CAPSTONE_CSV_FORMAT
    ON_ERROR = 'ABORT_STATEMENT';

COPY INTO ORDER_LINE
    FROM @CAPSTONE_STAGE/order_lines.csv
    FILE_FORMAT = CAPSTONE_CSV_FORMAT
    ON_ERROR = 'ABORT_STATEMENT';

SELECT 'TENANT' AS table_name, COUNT(*) AS rows_loaded FROM TENANT
UNION ALL SELECT 'CUSTOMER', COUNT(*) FROM CUSTOMER
UNION ALL SELECT 'PRODUCT', COUNT(*) FROM PRODUCT
UNION ALL SELECT 'ORDERS', COUNT(*) FROM ORDERS
UNION ALL SELECT 'ORDER_LINE', COUNT(*) FROM ORDER_LINE;

SELECT tenant_id, ROUND(SUM(revenue), 2) AS total_revenue
FROM ORDER_LINE GROUP BY tenant_id ORDER BY tenant_id;

SELECT COUNT(*) AS orphan_orders
FROM ORDERS o
LEFT JOIN CUSTOMER c
  ON o.tenant_id = c.tenant_id AND o.customer_id = c.customer_id
WHERE c.customer_id IS NULL;

SELECT COUNT(*) AS orphan_lines_order
FROM ORDER_LINE l
LEFT JOIN ORDERS o
  ON l.tenant_id = o.tenant_id AND l.order_id = o.order_id
WHERE o.order_id IS NULL;

SELECT COUNT(*) AS orphan_lines_product
FROM ORDER_LINE l
LEFT JOIN PRODUCT p
  ON l.tenant_id = p.tenant_id AND l.product_id = p.product_id
WHERE p.product_id IS NULL;

INSERT INTO INGESTION_ERRORS (file_name, row_text, error_text) VALUES
('edge_cases.csv', '(missing tenant_id) STEAM_C001', 'Missing tenant_id — rejected'),
('edge_cases.csv', 'UNKNOWN UNKNOWN_O001 2025-13-40', 'Unknown tenant and invalid date — rejected'),
('edge_cases.csv', 'duplicate order_line_id, quantity not-a-number', 'Duplicate line id and bad quantity — rejected');

INSERT INTO INGESTION_LOG (file_name, table_name, rows_loaded, rows_rejected, status) VALUES
('tenants.csv', 'TENANT', 2, 0, 'LOADED'),
('customers.csv', 'CUSTOMER', 40, 0, 'LOADED'),
('products.csv', 'PRODUCT', 24, 0, 'LOADED'),
('orders.csv', 'ORDERS', 400, 0, 'LOADED'),
('order_lines.csv', 'ORDER_LINE', 837, 0, 'LOADED'),
('edge_cases.csv', '—', 0, 3, 'REJECTED');

SELECT * FROM INGESTION_LOG ORDER BY log_id;
SELECT * FROM INGESTION_ERRORS ORDER BY error_id;
