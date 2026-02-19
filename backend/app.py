from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from database import Database
from analytics import Analytics
from datetime import datetime
import io
import csv
import traceback

app = Flask(__name__)
CORS(app)

db        = Database()
analytics = Analytics(db)


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})


@app.route('/api/dishes', methods=['GET'])
def get_dishes():
    try:
        return jsonify(db.get_dishes())
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingredients', methods=['GET'])
def get_ingredients():
    try:
        return jsonify(analytics.get_ingredients_status())
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders', methods=['POST'])
def add_order():
    try:
        data = request.get_json(silent=True) or {}

        # FIX: validate required fields and return a proper 400 instead of
        # crashing with a KeyError / 500.
        dish_id  = data.get('dish_id')
        quantity = data.get('quantity')

        if dish_id is None or quantity is None:
            return jsonify({'error': "'dish_id' and 'quantity' are required"}), 400

        try:
            dish_id  = int(dish_id)
            quantity = int(quantity)
        except (TypeError, ValueError):
            return jsonify({'error': "'dish_id' and 'quantity' must be integers"}), 400

        if quantity < 1:
            return jsonify({'error': "'quantity' must be at least 1"}), 400

        if db.add_order(dish_id, quantity):
            return jsonify({'message': 'Order added successfully'}), 201
        return jsonify({'error': 'Failed to add order'}), 400

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingredients/<int:ingredient_id>/deliver', methods=['POST'])
def deliver_ingredient(ingredient_id):
    """Set stock to 100 (full delivery)."""
    try:
        if db.deliver_ingredient(ingredient_id):
            return jsonify({'message': 'Ingredient restocked to 100'}), 200
        return jsonify({'error': 'Ingredient not found'}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingredients/<int:ingredient_id>', methods=['PUT'])
def update_ingredient(ingredient_id):
    """Rename an ingredient and/or change its unit or stock quantity."""
    try:
        data = request.get_json(silent=True) or {}
        if db.update_ingredient(ingredient_id, data):
            return jsonify({'message': 'Ingredient updated'}), 200
        return jsonify({'error': 'Ingredient not found'}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingredients', methods=['POST'])
def add_ingredient():
    """Add a new ingredient."""
    try:
        data = request.get_json(silent=True) or {}
        name = data.get('name', '').strip()
        unit = data.get('unit', 'units').strip()
        stock = float(data.get('stock_quantity', 100))
        if not name:
            return jsonify({'error': 'name is required'}), 400
        ing_id = db.add_ingredient(name, unit, stock)
        if ing_id:
            return jsonify({'message': 'Ingredient added', 'id': ing_id}), 201
        return jsonify({'error': 'Failed to add ingredient (may already exist)'}), 400
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/ingredients/<int:ingredient_id>', methods=['DELETE'])
def delete_ingredient(ingredient_id):
    """Remove an ingredient."""
    try:
        if db.delete_ingredient(ingredient_id):
            return jsonify({'message': 'Ingredient deleted'}), 200
        return jsonify({'error': 'Ingredient not found'}), 404
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/analytics/today', methods=['GET'])
def get_today_analytics():
    try:
        return jsonify(analytics.get_today_analytics())
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/analytics/date/<date>', methods=['GET'])
def get_analytics_by_date(date):
    try:
        # FIX: use the shared helper instead of duplicating the generate→dict
        # conversion here, which was out of sync with analytics.py.
        return jsonify(analytics.get_or_generate_report(date))
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/reports/download/<date>', methods=['GET'])
def download_report(date):
    try:
        report_data = analytics.download_report(date)
        report      = report_data['report']
        ingredients = report_data['ingredients']
        generated   = report_data['generated_at']

        # ── Derived metrics ──────────────────────────────────────────────────
        total_sales   = report['total_sales']
        total_orders  = report['total_orders']
        avg_order_val = round(total_sales / total_orders, 2) if total_orders > 0 else 0.00

        dishes_sold      = report.get('dishes_sold', {})
        ingredients_used = report.get('ingredients_used', {})

        top_dish     = max(dishes_sold, key=dishes_sold.get) if dishes_sold else 'N/A'
        top_dish_qty = dishes_sold[top_dish] if dishes_sold else 0

        low_stock = [i for i in ingredients if i.get('status') == 'Low']

        output = io.StringIO()
        w = csv.writer(output)

        # ── 1. Title block ───────────────────────────────────────────────────
        w.writerow(['FOOD SALES ANALYTICS — DAILY REPORT'])
        w.writerow(['Date', date])
        w.writerow(['Generated At', generated])
        w.writerow(['Report Period', f"{date} 00:00 – 23:59"])
        w.writerow([])

        # ── 2. Executive Summary ─────────────────────────────────────────────
        w.writerow(['EXECUTIVE SUMMARY'])
        w.writerow(['Metric', 'Value'])
        w.writerow(['Total Revenue', f"${total_sales:.2f}"])
        w.writerow(['Total Orders', total_orders])
        w.writerow(['Average Order Value', f"${avg_order_val:.2f}"])
        w.writerow(['Best-Selling Dish', f"{top_dish} ({top_dish_qty} sold)"])
        w.writerow(['Low Stock Alerts', len(low_stock)])
        w.writerow([])

        # ── 3. Dishes Sold ───────────────────────────────────────────────────
        w.writerow(['DISHES SOLD'])
        w.writerow(['Dish Name', 'Qty Sold', 'Share of Orders (%)'])

        total_dishes_qty = sum(dishes_sold.values()) or 1
        sorted_dishes = sorted(dishes_sold.items(), key=lambda x: x[1], reverse=True)
        for dish, qty in sorted_dishes:
            share = round((qty / total_dishes_qty) * 100, 1)
            w.writerow([dish, qty, f"{share}%"])

        if not sorted_dishes:
            w.writerow(['No dishes sold on this date', '', ''])
        w.writerow([])

        # ── 4. Ingredients Used ──────────────────────────────────────────────
        w.writerow(['INGREDIENTS USED TODAY'])
        w.writerow(['Ingredient', 'Qty Used', 'Unit'])

        sorted_ings_used = sorted(ingredients_used.items(), key=lambda x: x[1], reverse=True)
        for ing_name, qty in sorted_ings_used:
            unit = next((i['unit'] for i in ingredients if i['name'].lower() == ing_name.lower()), 'units')
            w.writerow([ing_name, f"{qty:.2f}", unit])

        if not sorted_ings_used:
            w.writerow(['No ingredients used', '', ''])
        w.writerow([])

        # ── 5. Current Inventory Status ──────────────────────────────────────
        w.writerow(['CURRENT INVENTORY STATUS'])
        w.writerow(['Ingredient', 'Current Stock', 'Unit', 'Stock %', 'Status'])

        sorted_inventory = sorted(ingredients, key=lambda x: x.get('percentage', 0))
        for ing in sorted_inventory:
            pct    = ing.get('percentage', 0)
            status = ing.get('status', 'Good')
            flag   = ' ⚠ REORDER' if status == 'Low' else ''
            w.writerow([
                ing['name'],
                ing['stock_quantity'],
                ing['unit'],
                f"{pct:.1f}%",
                f"{status}{flag}",
            ])
        w.writerow([])

        # ── 6. Low Stock Alerts ──────────────────────────────────────────────
        if low_stock:
            w.writerow(['LOW STOCK ALERTS — ACTION REQUIRED'])
            w.writerow(['Ingredient', 'Current Stock', 'Unit', 'Stock %'])
            for ing in low_stock:
                w.writerow([
                    ing['name'],
                    ing['stock_quantity'],
                    ing['unit'],
                    f"{ing.get('percentage', 0):.1f}%",
                ])
            w.writerow([])

        # ── 7. Footer ────────────────────────────────────────────────────────
        w.writerow(['Report generated by Food Sales Analytics Dashboard'])
        w.writerow(['End of Report'])

        output.seek(0)
        return send_file(
            io.BytesIO(output.getvalue().encode('utf-8')),
            mimetype='text/csv',
            as_attachment=True,
            download_name=f'food_sales_report_{date}.csv',
        )

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)