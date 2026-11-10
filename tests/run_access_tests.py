import os
import sys

import snowflake.connector

ACCOUNT = os.environ.get("SNOWFLAKE_ACCOUNT", "FQ39967")
HOST = os.environ.get("SNOWFLAKE_HOST", "FQ39967.ap-southeast-7.aws.snowflakecomputing.com")
USER = os.environ.get("SNOWFLAKE_USER", "ARYAN05")
PASSWORD = os.environ.get("SNOWFLAKE_PASSWORD")
WAREHOUSE = "CAPSTONE_WH"
DATABASE = "CAPSTONE_DB"

RESULTS = []


def connect():
    return snowflake.connector.connect(
        user=USER,
        password=PASSWORD,
        account=ACCOUNT,
        host=HOST,
        warehouse=WAREHOUSE,
        database=DATABASE,
    )


def execute(conn, role, sql):
    cur = conn.cursor()
    try:
        cur.execute("USE ROLE " + role)
        cur.execute("USE SECONDARY ROLES NONE")
        cur.execute("USE WAREHOUSE " + WAREHOUSE)
        cur.execute(sql)
        return cur.fetchall()
    finally:
        cur.close()


def statement(conn, role, sql):
    cur = conn.cursor()
    try:
        cur.execute("USE ROLE " + role)
        cur.execute("USE SECONDARY ROLES NONE")
        cur.execute("USE WAREHOUSE " + WAREHOUSE)
        cur.execute(sql)
    finally:
        cur.close()


def number(value):
    return float(value) if value is not None else value


def check(name, actual, expected):
    passed = actual == expected
    RESULTS.append(passed)
    print(("PASS" if passed else "FAIL") + " " + name + " | got " + str(actual) + ", expected " + str(expected))


def check_denied(name, conn, role, sql):
    try:
        execute(conn, role, sql)
    except Exception as error:
        RESULTS.append(True)
        print("PASS " + name + " | denied: " + str(error).split("\n")[0])
        return
    RESULTS.append(False)
    print("FAIL " + name + " | query was allowed, expected denial")


def kpis(conn, role):
    rows = execute(conn, role, "SELECT tenant_id, total_orders, total_customers, total_revenue, avg_order_value FROM " + DATABASE + ".ANALYTICS.V_KPIS ORDER BY tenant_id")
    return [(r[0], r[1], r[2], number(r[3]), number(r[4])) for r in rows]


def main():
    if not PASSWORD:
        print("SNOWFLAKE_PASSWORD is not set")
        return 2
    conn = connect()
    try:
        rows = execute(conn, "ACCOUNTADMIN", "LIST @" + DATABASE + ".TENANT_DATA.CAPSTONE_STAGE")
        check("T0 stage lists 5 files", len(rows), 5)
        rows = execute(conn, "ACCOUNTADMIN", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.CUSTOMER")
        check("T0 customers 40", rows[0][0], 40)
        rows = execute(conn, "ACCOUNTADMIN", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.ORDERS")
        check("T0 orders 400", rows[0][0], 400)
        rows = execute(conn, "ACCOUNTADMIN", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.ORDER_LINE")
        check("T0 order lines 837", rows[0][0], 837)
        rows = execute(conn, "ACCOUNTADMIN", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.INGESTION_LOG")
        check("T0 ingestion log 6 rows", rows[0][0], 6)

        rows = execute(conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER")
        check("T1 A sees 20 customers", rows[0][0], 20)
        rows = execute(conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_PRODUCT")
        check("T1 A sees 12 products", rows[0][0], 12)
        rows = execute(conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_ORDERS")
        check("T1 A sees 200 orders", rows[0][0], 200)
        rows = execute(conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_ORDER_LINE")
        check("T1 A sees 411 order lines", rows[0][0], 411)
        check("T1 A KPIs STEAM only", kpis(conn, "TENANT_A_ANALYST"), [("STEAM", 200, 20, 656950.4, 3284.75)])

        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER")
        check("T2 B sees 20 customers", rows[0][0], 20)
        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_PRODUCT")
        check("T2 B sees 12 products", rows[0][0], 12)
        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_ORDERS")
        check("T2 B sees 200 orders", rows[0][0], 200)
        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_ORDER_LINE")
        check("T2 B sees 426 order lines", rows[0][0], 426)
        check("T2 B KPIs EA only", kpis(conn, "TENANT_B_ANALYST"), [("EA", 200, 20, 854522.1, 4272.61)])

        rows = execute(conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER WHERE tenant_id = 'EA'")
        check("T3 A sees 0 EA customers", rows[0][0], 0)
        rows = execute(conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_ORDERS WHERE tenant_id = 'EA'")
        check("T3 A sees 0 EA orders", rows[0][0], 0)

        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER WHERE tenant_id = 'STEAM'")
        check("T4 B sees 0 STEAM customers", rows[0][0], 0)
        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_ORDERS WHERE tenant_id = 'STEAM'")
        check("T4 B sees 0 STEAM orders", rows[0][0], 0)

        check_denied("T5 A base-table read denied", conn, "TENANT_A_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.CUSTOMER")
        check_denied("T6 B base-table read denied", conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.ORDERS")

        check("T7 support sees both tenants", len(kpis(conn, "CAPSTONE_SUPPORT")), 2)
        rows = execute(conn, "CAPSTONE_SUPPORT", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER")
        check("T7 support sees 40 customers", rows[0][0], 40)
        rows = execute(conn, "ACCOUNTADMIN", "SELECT COUNT(*) FROM " + DATABASE + ".TENANT_DATA.SUPPORT_ACCESS_LOG")
        check("T7 support log 1 row", rows[0][0], 1)

        check("T8 Power BI A sees STEAM only", [r[0] for r in kpis(conn, "POWERBI_TENANT_A")], ["STEAM"])
        check("T8 Power BI B sees EA only", [r[0] for r in kpis(conn, "POWERBI_TENANT_B")], ["EA"])

        statement(conn, "ACCOUNTADMIN", "REVOKE SELECT ON VIEW " + DATABASE + ".ANALYTICS.V_CUSTOMER FROM ROLE TENANT_B_ANALYST")
        try:
            check_denied("T9 B denied after revoke", conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER")
        finally:
            statement(conn, "ACCOUNTADMIN", "GRANT SELECT ON VIEW " + DATABASE + ".ANALYTICS.V_CUSTOMER TO ROLE TENANT_B_ANALYST")
        rows = execute(conn, "TENANT_B_ANALYST", "SELECT COUNT(*) FROM " + DATABASE + ".ANALYTICS.V_CUSTOMER")
        check("T9 B sees 20 again after re-grant", rows[0][0], 20)
    finally:
        conn.close()
    passed = sum(RESULTS)
    total = len(RESULTS)
    print(str(passed) + "/" + str(total) + " checks passed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
