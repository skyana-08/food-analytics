import mysql.connector
from mysql.connector import Error
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from models import Dish, Order, Ingredient, DailyReport
from config import DB_CONFIG
import time


class Database:
    def __init__(self):
        self.init_database()

    # ── CONNECTION ────────────────────────────────────────────────────────────

    def _new_connection(self):
        """Open and return a brand-new connection. Never cached.
        
        Reusing a single persistent connection causes 'bytearray index out of
        range' when MySQL silently drops the connection server-side (wait_timeout)
        while is_connected() still returns True locally. Opening a fresh
        connection per call eliminates this entirely.
        """
        max_retries = 3
        retry_delay = 1

        for attempt in range(max_retries):
            try:
                conn = mysql.connector.connect(
                    host=DB_CONFIG['host'],
                    user=DB_CONFIG['user'],
                    password=DB_CONFIG['password'],
                    database=DB_CONFIG['database'],
                    port=DB_CONFIG['port'],
                    connection_timeout=DB_CONFIG['connection_timeout'],
                    autocommit=False,
                )
                return conn
            except Error as e:
                print(f"Connection attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    print("Could not connect to database.")
                    return None

    # ── INIT ──────────────────────────────────────────────────────────────────

    def init_database(self):
        """Create the database and all tables if they don't exist."""
        conn = cursor = None
        try:
            # Connect WITHOUT database so we can CREATE it if missing.
            conn = mysql.connector.connect(
                host=DB_CONFIG['host'],
                user=DB_CONFIG['user'],
                password=DB_CONFIG['password'],
                port=DB_CONFIG['port'],
                connection_timeout=DB_CONFIG['connection_timeout'],
                autocommit=False,
            )
            cursor = conn.cursor()

            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_CONFIG['database']}")
            cursor.execute(f"USE {DB_CONFIG['database']}")

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS dishes (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    price DECIMAL(10,2) NOT NULL,
                    ingredients JSON NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS ingredients (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    stock_quantity DECIMAL(10,2) NOT NULL,
                    unit VARCHAR(50) NOT NULL,
                    reorder_level DECIMAL(10,2) NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS orders (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    dish_id INT NOT NULL,
                    quantity INT NOT NULL,
                    order_time DATETIME NOT NULL,
                    date DATE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
                    INDEX idx_date (date),
                    INDEX idx_order_time (order_time)
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS daily_reports (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    date DATE NOT NULL UNIQUE,
                    total_sales DECIMAL(10,2) NOT NULL,
                    total_orders INT NOT NULL,
                    dishes_sold JSON NOT NULL,
                    ingredients_used JSON NOT NULL,
                    peak_hours JSON NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_report_date (date)
                )
            ''')

            conn.commit()
            print("Database tables ready.")
            self._insert_sample_data(cursor)
            conn.commit()

        except Error as e:
            print(f"Error initialising database: {e}")
            if conn:
                try: conn.rollback()
                except: pass
        finally:
            if cursor: cursor.close()
            if conn and conn.is_connected(): conn.close()

    def _insert_sample_data(self, cursor):
        """Insert sample dishes, ingredients and orders only when tables are empty."""
        try:
            cursor.execute("SELECT COUNT(*) FROM dishes")
            if cursor.fetchone()[0] != 0:
                return

            print("Inserting sample data...")

            dishes = [
                ("Margherita Pizza", 12.99, json.dumps({"flour": 0.3, "cheese": 0.2, "tomato_sauce": 0.15})),
                ("Chicken Burger",    8.99, json.dumps({"chicken": 0.2, "bun": 1,    "lettuce": 0.05})),
                ("Caesar Salad",      7.99, json.dumps({"lettuce": 0.2, "chicken": 0.1, "croutons": 0.05})),
                ("Pasta Carbonara",  10.99, json.dumps({"pasta": 0.25, "eggs": 2,    "bacon": 0.1})),
                ("Fish & Chips",     11.99, json.dumps({"fish": 0.2,   "potatoes": 0.3, "flour": 0.1})),
            ]
            cursor.executemany(
                "INSERT INTO dishes (name, price, ingredients) VALUES (%s, %s, %s)",
                dishes,
            )

            # All ingredients start at 100 (the defined maximum, = 100%).
            # reorder_level = 25 matches the 25% danger threshold.
            ingredients = [
                ("flour",        100.0, "kg",     25.0),
                ("cheese",       100.0, "kg",     25.0),
                ("tomato_sauce", 100.0, "liter",  25.0),
                ("chicken",      100.0, "kg",     25.0),
                ("bun",          100.0, "pieces", 25.0),
                ("lettuce",      100.0, "kg",     25.0),
                ("pasta",        100.0, "kg",     25.0),
                ("eggs",         100.0, "pieces", 25.0),
                ("bacon",        100.0, "kg",     25.0),
                ("fish",         100.0, "kg",     25.0),
                ("potatoes",     100.0, "kg",     25.0),
                ("croutons",     100.0, "kg",     25.0),
            ]
            cursor.executemany(
                "INSERT INTO ingredients (name, stock_quantity, unit, reorder_level) VALUES (%s, %s, %s, %s)",
                ingredients,
            )

            today     = datetime.now().date()
            yesterday = today - timedelta(days=1)

            orders_data = []
            schedule = {
                1: ([11, 13, 18, 19],  0,  2),
                2: ([12, 14, 17, 20], 15,  1),
                3: ([11, 13, 15, 18], 30,  1),
                4: ([12, 14, 19, 20], 45,  1),
                5: ([13, 17, 18, 21],  0,  1),
            }
            for date in [today, yesterday]:
                for dish_id, (hours, minute, qty) in schedule.items():
                    for hour in hours:
                        order_time = datetime.combine(
                            date,
                            datetime.min.time().replace(hour=hour, minute=minute),
                        )
                        orders_data.append((dish_id, qty, order_time, date))

            cursor.executemany(
                "INSERT INTO orders (dish_id, quantity, order_time, date) VALUES (%s, %s, %s, %s)",
                orders_data,
            )
            print(f"Inserted {len(orders_data)} sample orders.")

        except Error as e:
            print(f"Error inserting sample data: {e}")

    # ── GENERIC QUERY HELPER ─────────────────────────────────────────────────

    def execute_query(self, query, params=None, fetch_one=False, fetch_all=False):
        """Open a fresh connection, run one query, close the connection.

        A fresh connection per call is the simplest way to avoid stale-socket
        errors ('bytearray index out of range') with mysql-connector-python.
        """
        conn = self._new_connection()
        if conn is None:
            return None

        cursor = None
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(query, params or ())

            if fetch_one:
                return cursor.fetchone()
            if fetch_all:
                return cursor.fetchall()

            conn.commit()
            return cursor.lastrowid

        except Error as e:
            print(f"Query error: {e}")
            try: conn.rollback()
            except: pass
            return None
        finally:
            if cursor:
                try: cursor.close()
                except: pass
            if conn and conn.is_connected():
                conn.close()

    # ── PUBLIC METHODS ────────────────────────────────────────────────────────

    def add_order(self, dish_id: int, quantity: int) -> bool:
        """Insert an order and deduct ingredients from stock in one transaction."""
        conn = self._new_connection()
        if conn is None:
            return False

        cursor = None
        try:
            cursor = conn.cursor(dictionary=True)
            now = datetime.now()

            cursor.execute(
                "INSERT INTO orders (dish_id, quantity, order_time, date) VALUES (%s, %s, %s, %s)",
                (dish_id, quantity, now, now.date().isoformat()),
            )

            cursor.execute("SELECT ingredients FROM dishes WHERE id = %s", (dish_id,))
            dish_row = cursor.fetchone()
            if not dish_row:
                conn.rollback()
                print(f"Dish {dish_id} not found — order rolled back.")
                return False

            dish_ingredients = json.loads(dish_row['ingredients'])
            for ing_name, amount_per_unit in dish_ingredients.items():
                total_deduction = amount_per_unit * quantity
                cursor.execute(
                    "UPDATE ingredients SET stock_quantity = GREATEST(stock_quantity - %s, 0) WHERE name = %s",
                    (total_deduction, ing_name),
                )

            conn.commit()
            return True

        except Error as e:
            print(f"Error adding order: {e}")
            try: conn.rollback()
            except: pass
            return False
        finally:
            if cursor:
                try: cursor.close()
                except: pass
            if conn and conn.is_connected():
                conn.close()

    def deliver_ingredient(self, ingredient_id: int) -> bool:
        """Set stock_quantity to 100 (full delivery)."""
        result = self.execute_query(
            "UPDATE ingredients SET stock_quantity = 100 WHERE id = %s",
            (ingredient_id,),
        )
        return result is not None

    def update_ingredient(self, ingredient_id: int, data: dict) -> bool:
        """Update name, unit, and/or stock_quantity of an ingredient."""
        fields, params = [], []
        if 'name' in data and data['name'].strip():
            fields.append("name = %s")
            params.append(data['name'].strip())
        if 'unit' in data and data['unit'].strip():
            fields.append("unit = %s")
            params.append(data['unit'].strip())
        if 'stock_quantity' in data:
            qty = max(0.0, min(100.0, float(data['stock_quantity'])))
            fields.append("stock_quantity = %s")
            params.append(qty)
        if not fields:
            return False
        params.append(ingredient_id)
        result = self.execute_query(
            f"UPDATE ingredients SET {', '.join(fields)} WHERE id = %s",
            tuple(params),
        )
        return result is not None

    def add_ingredient(self, name: str, unit: str, stock: float = 100.0) -> Optional[int]:
        """Insert a new ingredient. Returns the new id or None."""
        return self.execute_query(
            "INSERT INTO ingredients (name, stock_quantity, unit, reorder_level) VALUES (%s, %s, %s, 25)",
            (name, min(100.0, max(0.0, stock)), unit),
        )

    def delete_ingredient(self, ingredient_id: int) -> bool:
        """Delete an ingredient by id."""
        result = self.execute_query(
            "DELETE FROM ingredients WHERE id = %s",
            (ingredient_id,),
        )
        return result is not None

    def get_dishes(self) -> List[Dict]:
        try:
            results = self.execute_query(
                "SELECT id, name, price, ingredients FROM dishes ORDER BY name",
                fetch_all=True,
            )
            return [
                {
                    'id': row['id'],
                    'name': row['name'],
                    'price': float(row['price']),
                    'ingredients': json.loads(row['ingredients']),
                }
                for row in (results or [])
            ]
        except Exception as e:
            print(f"Error getting dishes: {e}")
            return []

    def get_ingredients(self) -> List[Dict]:
        try:
            results = self.execute_query(
                "SELECT id, name, stock_quantity, unit, reorder_level FROM ingredients ORDER BY name",
                fetch_all=True,
            )
            return [
                {
                    'id': row['id'],
                    'name': row['name'],
                    'stock_quantity': float(row['stock_quantity']),
                    'unit': row['unit'],
                    'reorder_level': float(row['reorder_level']),
                }
                for row in (results or [])
            ]
        except Exception as e:
            print(f"Error getting ingredients: {e}")
            return []

    def get_orders_by_date(self, date: str) -> List[Dict]:
        try:
            results = self.execute_query(
                """SELECT o.id, o.dish_id, o.quantity, o.order_time, o.date,
                          d.name AS dish_name, d.price, d.ingredients
                     FROM orders o
                     JOIN dishes d ON o.dish_id = d.id
                    WHERE DATE(o.date) = %s
                    ORDER BY o.order_time DESC""",
                (date,),
                fetch_all=True,
            )
            return [
                {
                    'id': row['id'],
                    'dish_id': row['dish_id'],
                    'quantity': row['quantity'],
                    'order_time': (
                        row['order_time'].isoformat()
                        if hasattr(row['order_time'], 'isoformat')
                        else str(row['order_time'])
                    ),
                    'date': (
                        row['date'].isoformat()
                        if hasattr(row['date'], 'isoformat')
                        else str(row['date'])
                    ),
                    'dish_name': row['dish_name'],
                    'price': float(row['price']),
                    'ingredients': json.loads(row['ingredients']),
                }
                for row in (results or [])
            ]
        except Exception as e:
            print(f"Error getting orders by date: {e}")
            return []

    def get_daily_report(self, date: str) -> Optional[Dict]:
        try:
            row = self.execute_query(
                "SELECT * FROM daily_reports WHERE date = %s",
                (date,),
                fetch_one=True,
            )
            if not row:
                return None
            return {
                'date': (
                    row['date'].isoformat()
                    if hasattr(row['date'], 'isoformat')
                    else str(row['date'])
                ),
                'total_sales': float(row['total_sales']),
                'total_orders': row['total_orders'],
                'dishes_sold':       json.loads(row['dishes_sold'])       if row['dishes_sold']       else {},
                'ingredients_used':  json.loads(row['ingredients_used'])  if row['ingredients_used']  else {},
                'peak_hours':        json.loads(row['peak_hours'])         if row['peak_hours']        else {},
            }
        except Exception as e:
            print(f"Error getting daily report for {date}: {e}")
            return None

    def save_daily_report(self, report: DailyReport):
        try:
            self.execute_query(
                """INSERT INTO daily_reports
                       (date, total_sales, total_orders, dishes_sold, ingredients_used, peak_hours)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON DUPLICATE KEY UPDATE
                       total_sales      = VALUES(total_sales),
                       total_orders     = VALUES(total_orders),
                       dishes_sold      = VALUES(dishes_sold),
                       ingredients_used = VALUES(ingredients_used),
                       peak_hours       = VALUES(peak_hours)""",
                (
                    report.date,
                    report.total_sales,
                    report.total_orders,
                    json.dumps(report.dishes_sold),
                    json.dumps(report.ingredients_used),
                    json.dumps(report.peak_hours),
                ),
            )
            print(f"Daily report saved for {report.date}.")
        except Exception as e:
            print(f"Error saving daily report: {e}")