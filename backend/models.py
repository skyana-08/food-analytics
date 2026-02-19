from dataclasses import dataclass
from datetime import datetime
from typing import List, Dict

@dataclass
class Dish:
    id: int
    name: str
    price: float
    ingredients: Dict[str, float]

@dataclass
class Order:
    id: int
    dish_id: int
    quantity: int
    order_time: datetime
    date: str

@dataclass
class Ingredient:
    id: int
    name: str
    stock_quantity: float
    unit: str
    reorder_level: float

@dataclass
class DailyReport:
    date: str
    total_sales: float
    total_orders: int
    dishes_sold: Dict[str, int]
    ingredients_used: Dict[str, float]
    peak_hours: Dict[str, List[int]]