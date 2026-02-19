from datetime import datetime, timedelta
from typing import Dict, List
from collections import defaultdict
from models import DailyReport
from database import Database


class Analytics:
    def __init__(self, db: Database):
        self.db = db

    def generate_daily_report(self, date: str) -> DailyReport:
        orders = self.db.get_orders_by_date(date)
        dishes = self.db.get_dishes()

        print(f"Generating report for {date} ({len(orders)} orders)")

        total_sales = 0.0
        dishes_sold = defaultdict(int)
        ingredients_used = defaultdict(float)
        # Per-dish hourly distribution: { dish_name: [0]*24 }
        dish_hours = defaultdict(lambda: [0] * 24)

        for order in orders:
            dish_id  = order['dish_id']
            quantity = order['quantity']
            dish = next((d for d in dishes if d['id'] == dish_id), None)
            if not dish:
                continue

            total_sales += dish['price'] * quantity
            dishes_sold[dish['name']] += quantity

            for ing_name, ing_qty in dish['ingredients'].items():
                ingredients_used[ing_name] += ing_qty * quantity

            try:
                hour = datetime.fromisoformat(order['order_time']).hour
                dish_hours[dish['name']][hour] += quantity
            except (ValueError, TypeError):
                pass

        report = DailyReport(
            date=date,
            total_sales=round(total_sales, 2),
            total_orders=len(orders),
            dishes_sold=dict(dishes_sold),
            ingredients_used=dict(ingredients_used),
            peak_hours=dict(dish_hours),
        )

        self.db.save_daily_report(report)
        return report

    def _report_to_dict(self, report: DailyReport) -> Dict:
        return {
            'date': report.date,
            'total_sales': report.total_sales,
            'total_orders': report.total_orders,
            'dishes_sold': report.dishes_sold,
            'ingredients_used': report.ingredients_used,
            'peak_hours': report.peak_hours,
        }

    def get_or_generate_report(self, date: str) -> Dict:
        """Always regenerate from live orders so peak_hours is always per-dish dict format.
        The cached version may be in the old flat-array format, so we skip it."""
        return self._report_to_dict(self.generate_daily_report(date))

    def _ingredient_pct(self, stock_quantity: float) -> float:
        return round(min((stock_quantity / 100.0) * 100, 100), 1)

    def get_today_analytics(self) -> Dict:
        today     = datetime.now().date().isoformat()
        yesterday = (datetime.now().date() - timedelta(days=1)).isoformat()

        today_report_dict     = self.get_or_generate_report(today)
        yesterday_report_dict = self.db.get_daily_report(yesterday)

        ingredients = self.db.get_ingredients()
        for ing in ingredients:
            ing['percentage'] = self._ingredient_pct(ing['stock_quantity'])
            ing['status']     = 'Low' if ing['percentage'] <= 25 else 'Good'

        orders = self.db.get_orders_by_date(today)

        return {
            'today': today_report_dict,
            'yesterday': yesterday_report_dict,
            'comparison': (
                self._compare_reports(today_report_dict, yesterday_report_dict)
                if yesterday_report_dict else None
            ),
            'ingredients': ingredients,
            'dishes': self.db.get_dishes(),
            'orders': orders,
        }

    def _compare_reports(self, today: Dict, yesterday: Dict) -> Dict:
        sales_change   = today['total_sales']   - yesterday['total_sales']
        orders_change  = today['total_orders']  - yesterday['total_orders']

        sales_percent  = round((sales_change  / yesterday['total_sales']  * 100), 1) if yesterday['total_sales']  > 0 else 0
        orders_percent = round((orders_change / yesterday['total_orders'] * 100), 1) if yesterday['total_orders'] > 0 else 0

        def trend(change):
            if change > 0:   return 'up'
            if change < 0:   return 'down'
            return 'same'

        return {
            'sales_change':    round(sales_change, 2),
            'sales_percent':   sales_percent,
            'sales_trend':     trend(sales_change),
            'orders_change':   orders_change,
            'orders_percent':  orders_percent,
            'orders_trend':    trend(orders_change),
        }

    def get_ingredients_status(self) -> List[Dict]:
        ingredients = self.db.get_ingredients()
        for ing in ingredients:
            ing['percentage'] = self._ingredient_pct(ing['stock_quantity'])
            ing['status']     = 'Low' if ing['percentage'] <= 25 else 'Good'
        return ingredients

    def download_report(self, date: str) -> Dict:
        report_dict = self.get_or_generate_report(date)

        ingredients = self.db.get_ingredients()
        for ing in ingredients:
            ing['percentage'] = self._ingredient_pct(ing['stock_quantity'])
            ing['status']     = 'Low' if ing['percentage'] <= 25 else 'Good'

        return {
            'report': report_dict,
            'ingredients': ingredients,
            'dishes': self.db.get_dishes(),
            'generated_at': datetime.now().isoformat(),
        }