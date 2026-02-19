const API_BASE_URL = 'http://localhost:5000/api';

// Format a number as currency with comma separators e.g. $1,234.56
function formatMoney(value) {
    return '$' + parseFloat(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let dishesPieChart, peakHoursChart, ingredientsChart, hourlyTrendChart;

// Tab Switching Function
function openTab(event, tabId) {
    // Hide all tab content
    const tabContents = document.getElementsByClassName('tab-content');
    for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].classList.remove('active');
    }
    
    // Remove active class from all tab buttons
    const tabButtons = document.getElementsByClassName('tab-button');
    for (let i = 0; i < tabButtons.length; i++) {
        tabButtons[i].classList.remove('active');
    }
    
    // Show selected tab content and mark button as active
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
    
    // Load tab-specific data
    setTimeout(() => {
        switch(tabId) {
            case 'order-tab':
                loadRecentOrders();
                break;
            case 'analytics-tab':
                loadAnalyticsByDate();
                break;
            case 'reports-tab':
                updateReportPreview();
                break;
            case 'inventory-tab':
                loadInventoryData();
                break;
        }
    }, 100);
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
    updateCurrentDate();
    
    // Set default dates with null checks
    const today = new Date().toISOString().split('T')[0];
    
    const analyticsDate = document.getElementById('analytics-date');
    if (analyticsDate) analyticsDate.value = today;
    
    const reportStartDate = document.getElementById('report-start-date');
    if (reportStartDate) reportStartDate.value = today;
    
    const reportEndDate = document.getElementById('report-end-date');
    if (reportEndDate) reportEndDate.value = today;
    
    // Load all data
    loadDishes();
    loadTodayAnalytics();
    loadRecentOrders();
    loadInventoryData();
    
    // Auto-refresh every 30 seconds
    setInterval(() => {
        if (document.getElementById('order-tab')?.classList.contains('active')) {
            loadRecentOrders();
        }
        if (document.getElementById('inventory-tab')?.classList.contains('active')) {
            loadInventoryData();
        }
        if (document.getElementById('analytics-tab')?.classList.contains('active')) {
            loadAnalyticsByDate();
        }
    }, 30000);
});

function updateCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateElement = document.getElementById('current-date');
    if (dateElement) {
        dateElement.textContent = now.toLocaleDateString('en-US', options);
    }
}

async function loadDishes() {
    try {
        const response = await fetch(`${API_BASE_URL}/dishes`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const dishes = await response.json();
        
        const select = document.getElementById('dish-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">Select a dish</option>';
        
        dishes.forEach(dish => {
            const option = document.createElement('option');
            option.value = dish.id;
            // FIX: use toFixed(2) so floats like 12.990000001 render cleanly
            option.textContent = `${dish.name} — $${parseFloat(dish.price).toFixed(2)}`;
            select.appendChild(option);
        });

        console.log(`Loaded ${dishes.length} dishes into dropdown`);
    } catch (error) {
        console.error('Error loading dishes:', error);
        showError('Failed to load dishes. Make sure the backend server is running on port 5000.');
    }
}

async function addOrder() {
    const dishSelect = document.getElementById('dish-select');
    const quantity = document.getElementById('quantity');
    
    if (!dishSelect || !quantity) return;
    
    if (!dishSelect.value) {
        alert('Please select a dish');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                dish_id: parseInt(dishSelect.value),
                quantity: parseInt(quantity.value)
            })
        });
        
        if (response.ok) {
            alert('Order added successfully!');
            loadTodayAnalytics();
            loadRecentOrders();
            loadInventoryData();
            dishSelect.value = '';
            quantity.value = 1;
        } else {
            const error = await response.json();
            alert('Failed to add order: ' + (error.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error adding order:', error);
        alert('Error adding order. Check if backend server is running on port 5000.');
    }
}

async function loadRecentOrders() {
    try {
        const response = await fetch(`${API_BASE_URL}/analytics/today`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        // Get orders from today's data
        const orders = data.orders || [];
        const tbody = document.getElementById('recent-orders-body');
        if (tbody) {
            tbody.innerHTML = '';
            
            if (orders.length === 0) {
                const row = tbody.insertRow();
                row.innerHTML = '<td colspan="4" style="text-align: center;">No orders today</td>';
            } else {
                orders.slice(0, 10).forEach(order => {
                    const row = tbody.insertRow();
                    let timeString = order.order_time;
                    try {
                        const orderTime = new Date(order.order_time);
                        if (!isNaN(orderTime.getTime())) {
                            timeString = orderTime.toLocaleTimeString();
                        }
                    } catch (e) {}
                    
                    row.innerHTML = `
                        <td>${timeString}</td>
                        <td>${order.dish_name}</td>
                        <td>${order.quantity}</td>
                        <td>${formatMoney(order.price * order.quantity)}</td>
                    `;
                });
            }
        }
        
        // Update quick stats
        const quickSales = document.getElementById('quick-sales');
        const quickOrders = document.getElementById('quick-orders');
        const popularDish = document.getElementById('popular-dish');
        
        if (quickSales) quickSales.textContent = formatMoney(data.today.total_sales);
        if (quickOrders) quickOrders.textContent = data.today.total_orders || 0;
        
        // Find most popular dish
        const dishes = data.today.dishes_sold || {};
        let popular = '-';
        let maxQty = 0;
        for (const [dish, qty] of Object.entries(dishes)) {
            if (qty > maxQty) {
                maxQty = qty;
                popular = dish;
            }
        }
        if (popularDish) popularDish.textContent = popular;
        
    } catch (error) {
        console.error('Error loading recent orders:', error);
    }
}

async function loadTodayAnalytics() {
    try {
        const response = await fetch(`${API_BASE_URL}/analytics/today`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        if (document.getElementById('analytics-tab')?.classList.contains('active')) {
            updateAnalyticsCharts(data);
            // Also update comparison badges if yesterday data is present
            if (data.today && data.yesterday) {
                updateComparison(data.today, data.yesterday);
            }
        }
        
    } catch (error) {
        console.error('Error loading analytics:', error);
        showError('Failed to load analytics. Make sure the backend server is running on port 5000.');
    }
}

async function loadAnalyticsByDate() {
    const dateInput = document.getElementById('analytics-date');
    if (!dateInput) return;
    
    const date = dateInput.value;
    if (!date) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/analytics/date/${date}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        updateAnalyticsCharts({ today: data });
        
        // Fetch previous day for comparison
        const prevDate = new Date(date + 'T12:00:00'); // noon avoids DST edge cases
        prevDate.setDate(prevDate.getDate() - 1);
        const prevDateStr = prevDate.toISOString().split('T')[0];
        
        try {
            const prevResponse = await fetch(`${API_BASE_URL}/analytics/date/${prevDateStr}`);
            if (prevResponse.ok) {
                const prevData = await prevResponse.json();
                if (prevData && prevData.total_orders !== undefined) {
                    updateComparison(data, prevData);
                } else {
                    clearComparisonUI();
                }
            } else {
                clearComparisonUI();
            }
        } catch (e) {
            clearComparisonUI();
        }
        
    } catch (error) {
        console.error('Error loading analytics by date:', error);
    }
}

function clearComparisonUI() {
    const salesBadge  = document.getElementById('sales-comparison');
    const ordersBadge = document.getElementById('orders-comparison');
    if (salesBadge)  { salesBadge.innerHTML  = ''; salesBadge.className  = 'comparison-badge'; }
    if (ordersBadge) { ordersBadge.innerHTML = ''; ordersBadge.className = 'comparison-badge'; }
    const grid = document.getElementById('comparison-details');
    if (grid) grid.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:8px">No data for previous day.</div>';
}

function updateAnalyticsCharts(data) {
    const today = data.today || {};
    
    // Update summary cards
    const totalSales = document.getElementById('analytics-total-sales');
    const totalOrders = document.getElementById('analytics-total-orders');
    const avgOrderValue = document.getElementById('avg-order-value');
    
    if (totalSales) totalSales.textContent = formatMoney(today.total_sales);
    if (totalOrders) totalOrders.textContent = today.total_orders || 0;
    
    const avgValue = today.total_orders > 0 ? (today.total_sales / today.total_orders).toFixed(2) : '0.00';
    if (avgOrderValue) avgOrderValue.textContent = formatMoney(avgValue);
    
    // Update charts — peak_hours is now { dish_name: [24 ints], ... }
    updateDishesPieChart(today.dishes_sold || {});
    updatePeakHoursChart(today.peak_hours || {});
    updateHourlyTrendChart(today.peak_hours || {});
}

function updateComparison(current, previous) {
    const salesChange   = current.total_sales   - previous.total_sales;
    const ordersChange  = current.total_orders  - previous.total_orders;
    const salesPercent  = previous.total_sales  > 0 ? ((salesChange  / previous.total_sales)  * 100).toFixed(1) : '0.0';
    const ordersPercent = previous.total_orders > 0 ? ((ordersChange / previous.total_orders) * 100).toFixed(1) : '0.0';

    // Parse to numbers first to avoid string coercion in subtraction
    const avgCurrent  = current.total_orders  > 0 ? parseFloat((current.total_sales  / current.total_orders).toFixed(2))  : 0;
    const avgPrevious = previous.total_orders > 0 ? parseFloat((previous.total_sales / previous.total_orders).toFixed(2)) : 0;
    const avgChange   = avgCurrent - avgPrevious;
    const avgPercent  = avgPrevious > 0 ? ((avgChange / avgPrevious) * 100).toFixed(1) : '0.0';

    // Use Font Awesome 6 FREE icons only (arrow-up / arrow-down / minus)
    function trendIcon(change) {
        if (change > 0) return '<i class="fas fa-arrow-up"    style="color:#6db89a;font-size:0.9em"></i>';
        if (change < 0) return '<i class="fas fa-arrow-down"  style="color:#c97070;font-size:0.9em"></i>';
        return             '<i class="fas fa-minus"        style="color:#8a7d6e;font-size:0.9em"></i>';
    }
    function trendClass(change) {
        if (change > 0) return 'positive';
        if (change < 0) return 'negative';
        return 'neutral';
    }
    function pctLabel(pct, change) {
        const sign = change > 0 ? '+' : '';
        return `${sign}${pct}%`;
    }

    // Update the small badge on each summary card
    const salesBadge  = document.getElementById('sales-comparison');
    const ordersBadge = document.getElementById('orders-comparison');
    if (salesBadge) {
        salesBadge.innerHTML   = `${trendIcon(salesChange)} ${pctLabel(salesPercent, salesChange)}`;
        salesBadge.className   = `comparison-badge ${trendClass(salesChange)}`;
    }
    if (ordersBadge) {
        ordersBadge.innerHTML  = `${trendIcon(ordersChange)} ${pctLabel(ordersPercent, ordersChange)}`;
        ordersBadge.className  = `comparison-badge ${trendClass(ordersChange)}`;
    }

    // Update the comparison grid below the charts
    const comparisonGrid = document.getElementById('comparison-details');
    if (comparisonGrid) {
        comparisonGrid.innerHTML = `
            <div class="comparison-item ${trendClass(salesChange)}">
                <div class="comp-icon">${trendIcon(salesChange)}</div>
                <div class="comp-label">Sales</div>
                <div class="comp-value">${formatMoney(current.total_sales)}</div>
                <div class="comp-pct">${pctLabel(salesPercent, salesChange)} vs yesterday</div>
            </div>
            <div class="comparison-item ${trendClass(ordersChange)}">
                <div class="comp-icon">${trendIcon(ordersChange)}</div>
                <div class="comp-label">Orders</div>
                <div class="comp-value">${current.total_orders}</div>
                <div class="comp-pct">${pctLabel(ordersPercent, ordersChange)} vs yesterday</div>
            </div>
            <div class="comparison-item ${trendClass(avgChange)}">
                <div class="comp-icon">${trendIcon(avgChange)}</div>
                <div class="comp-label">Avg Order Value</div>
                <div class="comp-value">${formatMoney(avgCurrent)}</div>
                <div class="comp-pct">${pctLabel(avgPercent, avgChange)} vs yesterday</div>
            </div>
        `;
    }
}

function updateDishesPieChart(dishesSold) {
    const canvas = document.getElementById('dishesPieChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (dishesPieChart) dishesPieChart.destroy();
    
    const labels = Object.keys(dishesSold);
    const values = Object.values(dishesSold);
    
    if (labels.length === 0) {
        labels.push('No Data');
        values.push(1);
    }
    
    // Distinct warm palette — each color reads clearly against the dark background
    // and from each other: amber, sage, dusty rose, steel blue, terracotta,
    // mint, lavender, gold, coral, olive
    const palette = [
        '#d6a360',  // amber
        '#7ec8a0',  // sage green
        '#c47a8a',  // dusty rose
        '#6fa8c8',  // steel blue
        '#d4785a',  // terracotta
        '#a8c87e',  // yellow-green
        '#9b8ec4',  // soft lavender
        '#c8b44a',  // warm gold
        '#78b8c8',  // teal
        '#c89870',  // sand
    ];

    dishesPieChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: palette.slice(0, labels.length),
                borderColor: '#1c1c1c',
                borderWidth: 3,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#8a7d6e',
                        font: { family: "'DM Sans', sans-serif", size: 11 },
                        padding: 12,
                        boxWidth: 10,
                        boxHeight: 10,
                        generateLabels(chart) {
                            const d = chart.data;
                            return d.labels.map((label, i) => ({
                                text: `${label}  ×${d.datasets[0].data[i]}`,
                                fillStyle: d.datasets[0].backgroundColor[i],
                                strokeStyle: 'transparent',
                                hidden: false,
                                index: i
                            }));
                        }
                    }
                },
                tooltip: {
                    backgroundColor: '#1c1c1c',
                    borderColor: 'rgba(214,163,96,0.3)',
                    borderWidth: 1,
                    titleColor: '#f0e8da',
                    bodyColor: '#d6a360',
                    padding: 10,
                    callbacks: {
                        label(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.parsed / total) * 100).toFixed(1);
                            return ` ${ctx.parsed} orders  (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function updatePeakHoursChart(peakHours) {
    const canvas = document.getElementById('peakHoursChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (peakHoursChart) peakHoursChart.destroy();

    const hours = Array.from({length: 24}, (_, i) => `${i}:00`);
    const dishNames = Object.keys(peakHours);

    const palette = [
        'rgba(214,163,96,0.85)',   // amber
        'rgba(109,184,154,0.85)',  // green
        'rgba(122,173,204,0.85)',  // blue
        'rgba(201,112,112,0.85)',  // red
        'rgba(184,154,109,0.85)',  // tan
        'rgba(143,207,181,0.85)',  // mint
        'rgba(160,200,224,0.85)',  // sky
        'rgba(224,160,128,0.85)',  // peach
    ];

    const datasets = dishNames.length === 0
        ? [{ label: 'No Data', data: Array(24).fill(0), backgroundColor: 'rgba(74,67,64,0.4)', borderRadius: 3 }]
        : dishNames.map((dish, i) => ({
            label: dish,
            data: peakHours[dish] || Array(24).fill(0),
            backgroundColor: palette[i % palette.length],
            borderColor: palette[i % palette.length].replace('0.85', '1'),
            borderWidth: 0,
            borderRadius: 3,
            borderSkipped: false,
        }));

    peakHoursChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: hours, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: false,
                    ticks: { color: '#8a7d6e', font: { size: 9 }, maxRotation: 0 },
                    grid: { display: false },
                    border: { color: 'transparent' },
                },
                y: {
                    beginAtZero: true,
                    stacked: false,
                    ticks: { stepSize: 1, color: '#8a7d6e', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    border: { color: 'transparent' },
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#8a7d6e',
                        font: { size: 10 },
                        boxWidth: 10, boxHeight: 10, padding: 10,
                    }
                },
                tooltip: {
                    backgroundColor: '#1c1c1c',
                    borderColor: 'rgba(214,163,96,0.3)',
                    borderWidth: 1,
                    titleColor: '#f0e8da',
                    bodyColor: '#d6a360',
                    padding: 10,
                    mode: 'index',
                    intersect: false,
                }
            }
        }
    });
}

function updateHourlyTrendChart(peakHours) {
    const canvas = document.getElementById('hourlyTrendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (hourlyTrendChart) hourlyTrendChart.destroy();

    const hours  = Array.from({length: 24}, (_, i) => `${i}:00`);
    const dishes = Object.keys(peakHours);

    // Distinct, beautiful line colors
    const lineColors = [
        { line: '#d6a360', fill: 'rgba(214,163,96,0.12)'  },  // amber
        { line: '#6db89a', fill: 'rgba(109,184,154,0.10)' },  // green
        { line: '#7aadcc', fill: 'rgba(122,173,204,0.10)' },  // blue
        { line: '#c97070', fill: 'rgba(201,112,112,0.10)' },  // rose
        { line: '#b89a6d', fill: 'rgba(184,154,109,0.10)' },  // tan
        { line: '#8fcfb5', fill: 'rgba(143,207,181,0.10)' },  // mint
        { line: '#a0c8e0', fill: 'rgba(160,200,224,0.10)' },  // sky
        { line: '#e0a080', fill: 'rgba(224,160,128,0.10)' },  // peach
    ];

    const datasets = dishes.length === 0
        ? [{
            label: 'No Data',
            data: Array(24).fill(0),
            borderColor: 'rgba(255,255,255,0.08)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            tension: 0.4,
            fill: false,
            pointRadius: 0,
          }]
        : dishes.map((dish, i) => {
            const c = lineColors[i % lineColors.length];
            return {
                label: dish,
                data: peakHours[dish] || Array(24).fill(0),
                borderColor: c.line,
                backgroundColor: c.fill,
                borderWidth: 2,
                tension: 0.45,
                fill: false,
                pointRadius: 2.5,
                pointBackgroundColor: c.line,
                pointBorderColor: '#141414',
                pointBorderWidth: 1.5,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: c.line,
            };
          });

    hourlyTrendChart = new Chart(ctx, {
        type: 'line',
        data: { labels: hours, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, color: '#8a7d6e', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    border: { color: 'transparent' },
                },
                x: {
                    ticks: { color: '#8a7d6e', font: { size: 9 }, maxRotation: 0 },
                    grid: { display: false },
                    border: { color: 'transparent' },
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#8a7d6e',
                        font: { size: 10 },
                        boxWidth: 10, boxHeight: 2, padding: 12,
                        usePointStyle: true,
                        pointStyle: 'line',
                    }
                },
                tooltip: {
                    backgroundColor: '#1c1c1c',
                    borderColor: 'rgba(214,163,96,0.25)',
                    borderWidth: 1,
                    titleColor: '#8a7d6e',
                    bodyColor: '#f0e8da',
                    padding: 10,
                }
            }
        }
    });
}

async function loadInventoryData() {
    try {
        const response = await fetch(`${API_BASE_URL}/ingredients`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const ingredients = await response.json();
        
        // Update inventory list
        const inventoryList = document.getElementById('inventory-list');
        if (inventoryList) {
            inventoryList.innerHTML = '';
            
            let lowStockCount = 0;
            let totalValue = 0;
            
            ingredients.forEach(ing => {
                const item = document.createElement('div');
                item.className = 'inventory-item';
                
                if (ing.status === 'Low') lowStockCount++;
                
                // Estimate value (simplified)
                totalValue += ing.stock_quantity * 2; // Assuming $2 per unit average
                
                item.innerHTML = `
                    <span class="name">${ing.name}</span>
                    <div class="stock">
                        <span class="quantity">${ing.stock_quantity}</span>
                        <span class="unit">${ing.unit}</span>
                        <span class="status ${ing.status.toLowerCase()}">${ing.status}</span>
                    </div>
                `;
                inventoryList.appendChild(item);
            });
            
            // Update summary
            const lowStockCountEl = document.getElementById('low-stock-count');
            const totalIngredientsEl = document.getElementById('total-ingredients');
            const inventoryValueEl = document.getElementById('inventory-value');
            
            if (lowStockCountEl) lowStockCountEl.textContent = lowStockCount;
            if (totalIngredientsEl) totalIngredientsEl.textContent = ingredients.length;
            if (inventoryValueEl) inventoryValueEl.textContent = formatMoney(totalValue);
            
            // Show low stock alerts
            const alertsDiv = document.getElementById('low-stock-alerts');
            if (alertsDiv) {
                if (lowStockCount > 0) {
                    alertsDiv.classList.add('show');
                    alertsDiv.innerHTML = '<h4><i class="fas fa-exclamation-triangle"></i> Low Stock Alerts</h4>';
                    ingredients.filter(ing => ing.status === 'Low').forEach(ing => {
                        alertsDiv.innerHTML += `
                            <div class="alert-item">
                                <strong>${ing.name}</strong>: Only ${ing.stock_quantity} ${ing.unit} remaining
                                (Reorder at ${ing.reorder_level} ${ing.unit})
                            </div>
                        `;
                    });
                } else {
                    alertsDiv.classList.remove('show');
                }
            }
            
            // Update chart
            updateIngredientsChart(ingredients);
        }
        
    } catch (error) {
        console.error('Error loading inventory:', error);
    }
}

function updateIngredientsChart(ingredients) {
    const canvas = document.getElementById('ingredientsChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ingredientsChart) ingredientsChart.destroy();

    const MAX = 100;
    const DANGER_PCT = 25;

    // Distinct palette matching the dashboard aesthetic — cycles if > 12 ingredients
    const colorPalette = [
        { bg: 'rgba(214,163,96,0.80)',  border: '#d6a360' },  // amber
        { bg: 'rgba(126,200,160,0.80)', border: '#7ec8a0' },  // sage
        { bg: 'rgba(111,168,200,0.80)', border: '#6fa8c8' },  // steel blue
        { bg: 'rgba(196,122,138,0.80)', border: '#c47a8a' },  // dusty rose
        { bg: 'rgba(155,142,196,0.80)', border: '#9b8ec4' },  // lavender
        { bg: 'rgba(200,180,74,0.80)',  border: '#c8b44a' },  // warm gold
        { bg: 'rgba(120,184,200,0.80)', border: '#78b8c8' },  // teal
        { bg: 'rgba(168,200,126,0.80)', border: '#a8c87e' },  // yellow-green
        { bg: 'rgba(200,152,112,0.80)', border: '#c89870' },  // sand
        { bg: 'rgba(100,188,168,0.80)', border: '#64bcb8' },  // aqua
        { bg: 'rgba(200,120,96,0.80)',  border: '#c87860' },  // coral
        { bg: 'rgba(160,140,220,0.80)', border: '#a08cdc' },  // periwinkle
    ];

    const labels = ingredients.map(ing => ing.name);
    const values = ingredients.map(ing => Math.min((ing.stock_quantity / MAX) * 100, 100));

    // Each ingredient gets its own color; if below 25% override to red
    const bgColors     = values.map((pct, i) =>
        pct <= DANGER_PCT ? 'rgba(201,112,112,0.85)' : colorPalette[i % colorPalette.length].bg
    );
    const borderColors = values.map((pct, i) =>
        pct <= DANGER_PCT ? '#c97070' : colorPalette[i % colorPalette.length].border
    );

    ingredientsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Stock %',
                data: values,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1,
                borderRadius: 5,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: '#8a7d6e', font: { size: 11 }, callback: v => `${v}%` },
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    border: { color: 'transparent' },
                },
                y: {
                    ticks: { color: '#8a7d6e', font: { size: 11 } },
                    grid: { display: false },
                    border: { color: 'transparent' },
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1c1c1c',
                    borderColor: 'rgba(214,163,96,0.3)',
                    borderWidth: 1,
                    titleColor: '#f0e8da',
                    bodyColor: '#d6a360',
                    padding: 12,
                    callbacks: {
                        label(ctx) {
                            const ing = ingredients[ctx.dataIndex];
                            const pct = ctx.parsed.x.toFixed(1);
                            const flag = parseFloat(pct) <= DANGER_PCT ? '  ⚠ LOW STOCK' : '';
                            return `  ${ing.stock_quantity} / 100 ${ing.unit}   (${pct}%)${flag}`;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'dangerLine',
            afterDraw(chart) {
                const { ctx: c, chartArea: { top, bottom }, scales: { x } } = chart;
                const xPos = x.getPixelForValue(DANGER_PCT);
                c.save();
                c.beginPath();
                c.moveTo(xPos, top);
                c.lineTo(xPos, bottom);
                c.strokeStyle = 'rgba(201,112,112,0.55)';
                c.lineWidth = 1.5;
                c.setLineDash([5, 4]);
                c.stroke();
                c.restore();
            }
        }]
    });
}

function refreshInventory() {
    loadInventoryData();
}

async function updateReportPreview() {
    const dateInput = document.getElementById('report-start-date');
    if (!dateInput) return;
    
    const date = dateInput.value;
    if (!date) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/analytics/date/${date}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        const preview = document.getElementById('report-preview');
        if (preview) {
            let html = '<h4>Report Preview</h4>';
            html += '<table style="width:100%; border-collapse: collapse;">';
            html += '<tr><th style="text-align:left; padding:8px; border-bottom:2px solid #dee2e6;">Item</th><th style="text-align:right; padding:8px; border-bottom:2px solid #dee2e6;">Value</th></tr>';
            
            // Summary
            html += `<tr><td style="padding:8px;"><strong>Total Sales:</strong></td><td style="text-align:right; padding:8px;">$${data.total_sales || 0}</td></tr>`;
            html += `<tr><td style="padding:8px;"><strong>Total Orders:</strong></td><td style="text-align:right; padding:8px;">${data.total_orders || 0}</td></tr>`;
            
            // Dishes sold
            html += '<tr><td style="padding:8px; border-bottom:1px solid #dee2e6;"><strong>Dishes Sold:</strong></td><td style="text-align:right; padding:8px; border-bottom:1px solid #dee2e6;"></td></tr>';
            for (const [dish, qty] of Object.entries(data.dishes_sold || {})) {
                html += `<tr><td style="padding:8px; padding-left:20px;">${dish}</td><td style="text-align:right; padding:8px;">${qty}</td></tr>`;
            }
            
            if (Object.keys(data.dishes_sold || {}).length === 0) {
                html += '<tr><td style="padding:8px; padding-left:20px;" colspan="2">No dishes sold</td></tr>';
            }
            
            // Ingredients used
            html += '<tr><td style="padding:8px;"><strong>Ingredients Used:</strong></td><td style="text-align:right; padding:8px;"></td></tr>';
            for (const [ing, qty] of Object.entries(data.ingredients_used || {})) {
                html += `<tr><td style="padding:8px; padding-left:20px;">${ing}</td><td style="text-align:right; padding:8px;">${qty.toFixed(2)}</td></tr>`;
            }
            
            if (Object.keys(data.ingredients_used || {}).length === 0) {
                html += '<tr><td style="padding:8px; padding-left:20px;" colspan="2">No ingredients used</td></tr>';
            }
            
            html += '</table>';
            preview.innerHTML = html;
        }
        
    } catch (error) {
        console.error('Error loading report preview:', error);
    }
}

async function downloadReportRange() {
    const startDate = document.getElementById('report-start-date');
    const endDate = document.getElementById('report-end-date');
    
    if (!startDate || !endDate) return;
    
    const start = startDate.value;
    const end = endDate.value;
    
    if (!start || !end) {
        alert('Please select both start and end dates');
        return;
    }
    
    try {
        // If it's a single day, download that day's report
        if (start === end) {
            window.location.href = `${API_BASE_URL}/reports/download/${start}`;
        } else {
            // For now, just download the start date
            window.location.href = `${API_BASE_URL}/reports/download/${start}`;
            alert('Date range downloading coming soon. Downloading report for start date.');
        }
    } catch (error) {
        console.error('Error downloading report:', error);
        alert('Error downloading report');
    }
}

async function quickDownload(type) {
    const today = new Date().toISOString().split('T')[0];
    let date = today;
    
    if (type === 'yesterday') {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        date = yesterday.toISOString().split('T')[0];
        window.location.href = `${API_BASE_URL}/reports/download/${date}`;
    } else if (type === 'today') {
        window.location.href = `${API_BASE_URL}/reports/download/${today}`;
    } else {
        alert(`${type} report feature coming soon! Downloading today's report for now.`);
        window.location.href = `${API_BASE_URL}/reports/download/${today}`;
    }
}

// ── INVENTORY MODAL ──────────────────────────────────────────────────────────

let _modalIngredients = [];  // cache so rows can save without re-fetching

function openInventoryModal() {
    document.getElementById('inventory-modal').classList.add('open');
    loadModalIngredients();
}

function closeInventoryModal() {
    document.getElementById('inventory-modal').classList.remove('open');
}

function closeModalOnOverlay(e) {
    if (e.target === document.getElementById('inventory-modal')) closeInventoryModal();
}

async function loadModalIngredients() {
    try {
        const res = await fetch(`${API_BASE_URL}/ingredients`);
        if (!res.ok) throw new Error('fetch failed');
        _modalIngredients = await res.json();
        renderModalList(_modalIngredients);
    } catch (e) {
        console.error('Error loading modal ingredients:', e);
    }
}

function renderModalList(ingredients) {
    const container = document.getElementById('modal-ing-list');
    if (!container) return;

    container.innerHTML = `
        <div class="modal-ing-label">
            <span>Name</span><span>Unit</span><span>Stock</span><span></span><span></span>
        </div>`;

    ingredients.forEach(ing => {
        const pct = Math.min((ing.stock_quantity / 100) * 100, 100).toFixed(1);
        const isLow = parseFloat(pct) <= 25;
        const fillColor = isLow ? '#c97070' : '#d6a360';
        const row = document.createElement('div');
        row.className = 'modal-ing-row';
        row.dataset.id = ing.id;
        row.innerHTML = `
            <div>
                <input type="text" class="ing-name-input" value="${ing.name}" placeholder="Name">
                <div class="modal-ing-stock-bar">
                    <div class="modal-ing-stock-fill" style="width:${pct}%;background:${fillColor}"></div>
                </div>
            </div>
            <input type="text"   class="ing-unit-input"  value="${ing.unit}"          placeholder="Unit">
            <input type="number" class="ing-stock-input" value="${ing.stock_quantity}" placeholder="0–100" min="0" max="100" step="0.1">
            <button class="deliver-btn" onclick="deliverIngredient(${ing.id}, this)" title="Restock to 100">
                <i class="fas fa-truck"></i> Delivered
            </button>
            <button class="modal-save-btn" onclick="saveIngredientRow(${ing.id}, this)" title="Save changes">
                <i class="fas fa-check"></i>
            </button>
            <button class="modal-del-btn"  onclick="deleteIngredientRow(${ing.id}, this)" title="Delete ingredient">
                <i class="fas fa-trash"></i>
            </button>
        `;
        container.appendChild(row);
    });
}

async function deliverIngredient(id, btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        const res = await fetch(`${API_BASE_URL}/ingredients/${id}/deliver`, { method: 'POST' });
        if (!res.ok) throw new Error('failed');
        // Update the row inputs + stock bar
        const row = btn.closest('.modal-ing-row');
        row.querySelector('.ing-stock-input').value = 100;
        const fill = row.querySelector('.modal-ing-stock-fill');
        fill.style.width = '100%';
        fill.style.background = '#d6a360';
        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-truck"></i> Delivered'; }, 1500);
        refreshInventory();
    } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-truck"></i> Delivered';
        alert('Failed to restock ingredient.');
    }
}

async function saveIngredientRow(id, btn) {
    const row = btn.closest('.modal-ing-row');
    const name  = row.querySelector('.ing-name-input').value.trim();
    const unit  = row.querySelector('.ing-unit-input').value.trim();
    const stock = parseFloat(row.querySelector('.ing-stock-input').value);

    if (!name) { alert('Name cannot be empty'); return; }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/ingredients/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, unit, stock_quantity: stock }),
        });
        if (!res.ok) throw new Error('failed');
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i>'; }, 1000);
        refreshInventory();
    } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        alert('Failed to save changes.');
    }
}

async function deleteIngredientRow(id, btn) {
    if (!confirm('Delete this ingredient? This cannot be undone.')) return;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const res = await fetch(`${API_BASE_URL}/ingredients/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('failed');
        btn.closest('.modal-ing-row').remove();
        refreshInventory();
    } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i>';
        alert('Failed to delete ingredient.');
    }
}

async function addIngredientFromModal() {
    const name  = document.getElementById('new-ing-name').value.trim();
    const unit  = document.getElementById('new-ing-unit').value.trim() || 'units';
    const stock = parseFloat(document.getElementById('new-ing-stock').value) || 100;

    if (!name) { alert('Please enter a name for the ingredient.'); return; }

    try {
        const res = await fetch(`${API_BASE_URL}/ingredients`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, unit, stock_quantity: stock }),
        });
        if (!res.ok) {
            const err = await res.json();
            alert(err.error || 'Failed to add ingredient');
            return;
        }
        // Clear inputs & reload list
        document.getElementById('new-ing-name').value  = '';
        document.getElementById('new-ing-unit').value  = '';
        document.getElementById('new-ing-stock').value = 100;
        loadModalIngredients();
        refreshInventory();
    } catch(e) {
        alert('Error adding ingredient.');
    }
}

// ── CHART ZOOM MODAL ─────────────────────────────────────────────────────────

let zoomedChart = null;

/**
 * Map a source canvas chart ID to its Chart.js instance and config,
 * then render a clone inside the zoom modal.
 */
function openChartZoom(sourceCanvasId, iconClass, title) {
    // Map canvas ID → live Chart.js instance
    const chartMap = {
        'dishesPieChart':    dishesPieChart,
        'peakHoursChart':    peakHoursChart,
        'hourlyTrendChart':  hourlyTrendChart,
        'ingredientsChart':  ingredientsChart,
    };

    const sourceChart = chartMap[sourceCanvasId];
    if (!sourceChart) return;

    // Set modal title
    document.getElementById('chart-zoom-title-text').textContent = title;
    document.getElementById('chart-zoom-icon').className = iconClass;

    // Open modal
    const modal = document.getElementById('chart-zoom-modal');
    modal.classList.add('open');

    // Destroy previous zoomed chart if any
    if (zoomedChart) { zoomedChart.destroy(); zoomedChart = null; }

    // Deep-clone config from the source chart
    const cfg = sourceChart.config;
    const clonedData = JSON.parse(JSON.stringify(cfg.data));

    // Preserve plugin arrays (can't JSON-clone functions)
    const originalPlugins = cfg.plugins || [];

    // Build zoomed options — same as source but with bigger fonts
    const zoomedOptions = JSON.parse(JSON.stringify(cfg.options || {}));
    zoomedOptions.responsive = true;
    zoomedOptions.maintainAspectRatio = false;
    if (!zoomedOptions.plugins) zoomedOptions.plugins = {};
    if (!zoomedOptions.plugins.legend) zoomedOptions.plugins.legend = {};
    zoomedOptions.plugins.legend.labels = {
        ...(zoomedOptions.plugins.legend.labels || {}),
        font: { size: 13 },
        padding: 18,
    };

    const zoomCtx = document.getElementById('chartZoomCanvas').getContext('2d');
    zoomedChart = new Chart(zoomCtx, {
        type: cfg.type,
        data: clonedData,
        options: zoomedOptions,
        plugins: originalPlugins,
    });
}

function closeChartZoom() {
    document.getElementById('chart-zoom-modal').classList.remove('open');
    if (zoomedChart) { zoomedChart.destroy(); zoomedChart = null; }
}

function closeChartZoomOnOverlay(e) {
    if (e.target === document.getElementById('chart-zoom-modal')) closeChartZoom();
}

// Close on Escape key
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeChartZoom();
        closeInventoryModal();
    }
});

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.cssText = `
        background-color: #f8d7da;
        color: #721c24;
        padding: 12px;
        border-radius: 8px;
        margin: 10px 0;
        text-align: center;
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    `;
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => errorDiv.remove(), 5000);
}