import csv
import os
import random
from datetime import date, timedelta

random.seed(30)

OUT = "data"
os.makedirs(OUT, exist_ok=True)

TENANTS = [
    ("STEAM", "Steam Valve Corporation"),
    ("EA", "Electronic Arts"),
]

FIRST = ["Aarav", "Priya", "Rohan", "Sneha", "Vikram", "Ananya", "Karan",
         "Meera", "Arjun", "Divya", "Nikhil", "Ishita", "Rahul", "Kavya",
         "Aditya", "Nisha", "Varun", "Pooja", "Sanjay", "Ritu"]
LAST = ["Sharma", "Patel", "Iyer", "Reddy", "Khan", "Gupta", "Nair",
        "Singh", "Das", "Joshi", "Mehta", "Chopra", "Rao", "Menon"]

CITIES = [
    ("Mumbai", "West"), ("Pune", "West"), ("Delhi", "North"),
    ("Jaipur", "North"), ("Bengaluru", "South"), ("Chennai", "South"),
    ("Kolkata", "East"), ("Guwahati", "East"),
]
SEGMENTS = ["Consumer", "Small Business", "Corporate"]

# Made-up game titles only — no real Steam or EA titles.
STEAM_GAMES = [
    ("Star Forge", "Action", 1499), ("Neon Harbor", "Adventure", 999),
    ("Castle of Echoes", "RPG", 1999), ("Pixel Quest", "Adventure", 499),
    ("Deep Space Miner", "Strategy", 1299), ("Shadow Circuit", "Action", 1499),
    ("Frost Valley", "RPG", 1799), ("Turbo Kart Legends", "Racing", 999),
    ("Mystic Isles", "Adventure", 1199), ("Robot Uprising", "Action", 1999),
    ("Sky Pirates", "Adventure", 1499), ("Dungeon Crawl", "RPG", 999),
]
EA_GAMES = [
    ("Pro Soccer Stars", "Sports", 2999), ("Galaxy Racer", "Racing", 1499),
    ("Battle Arena X", "Action", 1999), ("Kingdom Builders", "Strategy", 1799),
    ("Zombie Survival", "Action", 1299), ("Ocean Explorer", "Adventure", 999),
    ("Mech Warriors", "Action", 2499), ("Fantasy League", "Sports", 1999),
    ("Speed Drift", "Racing", 1199), ("Alien Invasion", "Action", 1499),
    ("Treasure Hunt", "Adventure", 999), ("Cyber City", "RPG", 1799),
]

CHANNELS = ["Online", "Retail Store", "Partner"]
DISCOUNTS = [0, 0, 0, 5, 5, 10, 15]  # most orders have no discount

def write_csv(name, header, rows):
    path = os.path.join(OUT, name)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"{name}: {len(rows)} rows -> {path}")
    return len(rows)

def write_per_tenant(name, header, rows, tenant_col=0):
    for tid, _ in TENANTS:
        write_csv(f"{tid}/{name}", header, [r for r in rows if r[tenant_col] == tid])

# --- tenants ---
tenant_rows = [[tid, tname, "2025-01-01"] for tid, tname in TENANTS]
write_csv("tenants.csv",
          ["tenant_id", "tenant_name", "created_at"], tenant_rows)

# --- customers: 20 per tenant ---
customer_rows = []
customers_by_tenant = {}
for tid, _ in TENANTS:
    names = random.sample(FIRST, 20)
    surnames = [random.choice(LAST) for _ in range(20)]
    lst = []
    for i in range(20):
        cid = f"{tid}_C{i+1:03d}"
        city, region = random.choice(CITIES)
        segment = random.choice(SEGMENTS)
        row = [tid, cid, f"{names[i]} {surnames[i]}", city, region, segment, "2025-01-01"]
        customer_rows.append(row)
        lst.append(cid)
    customers_by_tenant[tid] = lst
write_per_tenant("customers.csv",
          ["tenant_id", "customer_id", "customer_name", "city", "region", "segment", "created_at"],
          customer_rows)

# --- products: 12 per tenant ---
product_rows = []
products_by_tenant = {}
for tid, games in [("STEAM", STEAM_GAMES), ("EA", EA_GAMES)]:
    lst = []
    for i, (name, cat, price) in enumerate(games):
        pid = f"{tid}_P{i+1:03d}"
        product_rows.append([tid, pid, name, cat, price])
        lst.append((pid, price))
    products_by_tenant[tid] = lst
write_per_tenant("products.csv",
          ["tenant_id", "product_id", "product_name", "category", "list_price"],
          product_rows)

# --- orders: 200 per tenant, 2025-01-01 to 2025-12-31 ---
order_rows = []
orders_by_tenant = {}  # tid -> list of (order_id, customer_id)
start = date(2025, 1, 1)
for tid, _ in TENANTS:
    lst = []
    for i in range(200):
        oid = f"{tid}_O{i+1:03d}"
        cid = random.choice(customers_by_tenant[tid])
        odate = start + timedelta(days=random.randint(0, 364))
        channel = random.choices(CHANNELS, weights=[50, 30, 20])[0]
        order_rows.append([tid, oid, cid, odate.isoformat(), channel])
        lst.append(oid)
    orders_by_tenant[tid] = lst
write_per_tenant("orders.csv",
          ["tenant_id", "order_id", "customer_id", "order_date", "sales_channel"],
          order_rows)

# --- order lines: 1-3 per order ---
line_rows = []
n = 0
for tid, _ in TENANTS:
    for oid in orders_by_tenant[tid]:
        for _ in range(random.randint(1, 3)):
            n += 1
            lid = f"{tid}_L{n:04d}"
            pid, price = random.choice(products_by_tenant[tid])
            qty = random.choice([1, 1, 1, 2])
            disc = random.choice(DISCOUNTS)
            revenue = round(qty * price * (1 - disc / 100), 2)
            line_rows.append([lid, tid, oid, pid, qty, price, disc, revenue])
write_per_tenant("order_lines.csv",
          ["order_line_id", "tenant_id", "order_id", "product_id",
           "quantity", "unit_price", "discount_pct", "revenue"],
          line_rows, tenant_col=1)

# --- edge cases: 3 bad rows, kept separate so they are never loaded ---
# 1. missing tenant_id, 2. unknown tenant, 3. duplicate order_line_id + bad date
edge_rows = [
    ["", "STEAM_C001", "Bad Customer", "Mumbai", "West", "Consumer", "2025-01-01"],
    ["UNKNOWN", "UNKNOWN_O001", "STEAM_C001", "2025-13-40", "Online"],
    [line_rows[0][0], "STEAM", line_rows[0][2], line_rows[0][3], "not-a-number", 999, 0, 999],
]
write_csv("edge_cases.csv",
          ["note", "col2", "col3", "col4", "col5", "col6", "col7", "col8"],
          edge_rows)

print()
print("Expected clean counts in Snowflake:")
print("  TENANT: 2")
print("  CUSTOMER: 40  (20 STEAM + 20 EA)")
print("  PRODUCT: 24  (12 STEAM + 12 EA)")
print("  ORDERS: 400  (200 STEAM + 200 EA)")
print(f"  ORDER_LINE: {len(line_rows)}")
print("  edge_cases.csv: 3 bad rows — to be rejected, not loaded")
print("Total revenue check: sum ORDER_LINE revenue per tenant in SQL,")
print("then compare with the Python total below.")
total = {}
for r in line_rows:
    total[r[1]] = total.get(r[1], 0) + float(r[7])
for tid in total:
    print(f"  {tid} revenue: {total[tid]:.2f}")
