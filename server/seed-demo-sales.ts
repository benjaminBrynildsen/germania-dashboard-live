#!/usr/bin/env node --import tsx
/**
 * Generate realistic demo sales data for Germania locations
 */

import db from './db.js';

const LOCATIONS = [
  { id: 131, name: 'G1 - Alton', baseRevenue: 650, variance: 150 },
  { id: 132, name: 'G2 - Godfrey', baseRevenue: 550, variance: 120 },
  { id: 133, name: 'G3 - East Gate', baseRevenue: 480, variance: 100 },
  { id: 134, name: 'G4 - Jerseyville', baseRevenue: 420, variance: 90 },
];

function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr).getDay();
}

function isHoliday(dateStr: string): boolean {
  const holidays = [
    '2025-01-01', '2025-02-14', '2025-03-17', '2025-05-26', '2025-07-04',
    '2025-09-01', '2025-10-31', '2025-11-27', '2025-12-25', '2025-12-31',
    '2026-01-01', '2026-02-14', '2026-03-17',
  ];
  return holidays.includes(dateStr);
}

function generateSalesForDay(location: any, date: string, weatherData: any): { sales: number; transactions: number } {
  const dow = getDayOfWeek(date);
  const isWeekend = dow === 0 || dow === 6;
  const holiday = isHoliday(date);
  
  // Base multiplier for day of week
  let multiplier = 1.0;
  if (dow === 0) multiplier = 1.3; // Sunday
  else if (dow === 6) multiplier = 1.4; // Saturday
  else if (dow === 5) multiplier = 1.15; // Friday
  else if (dow === 1) multiplier = 0.85; // Monday
  
  // Holiday boost
  if (holiday) multiplier *= 1.2;
  
  // Weather impact
  if (weatherData) {
    const snow = weatherData.snowfall || 0;
    const temp = weatherData.temp_min || 32;
    
    // Snow impact (negative)
    if (snow > 4) multiplier *= 0.3; // Heavy snow = big drop
    else if (snow > 2) multiplier *= 0.6;
    else if (snow > 0.5) multiplier *= 0.85;
    
    // Extreme cold
    if (temp < 0) multiplier *= 0.75;
    else if (temp < 15) multiplier *= 0.9;
  }
  
  // Random daily variance
  const randomFactor = 0.85 + Math.random() * 0.3; // ±15%
  
  const baseSales = location.baseRevenue * multiplier * randomFactor;
  const variance = location.variance * (Math.random() - 0.5);
  const totalSales = Math.max(100, baseSales + variance);
  
  const avgTicketSize = 8.50 + Math.random() * 3; // $8.50 - $11.50
  const transactions = Math.round(totalSales / avgTicketSize);
  
  return { sales: Math.round(totalSales * 100) / 100, transactions };
}

function main() {
  console.log('🎲 Generating demo sales data...\n');
  
  const startDate = '2025-01-01';
  const endDate = new Date().toISOString().split('T')[0];
  const dates = getDateRange(startDate, endDate);
  
  // Load weather data for correlation
  const weatherStmt = db.prepare('SELECT * FROM weather_daily WHERE date = ?');
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO sales_daily (date, location_id, location_name, total_sales, transaction_count, avg_ticket)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  let totalRecords = 0;
  
  for (const location of LOCATIONS) {
    console.log(`Generating sales for ${location.name}...`);
    
    for (const date of dates) {
      const weather = weatherStmt.get(date) as any;
      const { sales, transactions } = generateSalesForDay(location, date, weather);
      const avgTicket = sales / transactions;
      
      insertStmt.run(date, location.id, location.name, sales, transactions, avgTicket);
      totalRecords++;
    }
    
    console.log(`  ✅ Generated ${dates.length} days of sales data`);
  }
  
  console.log(`\n✨ Complete! Generated ${totalRecords} sales records`);
  
  // Show some sample anomalies
  console.log('\n📊 Sample anomaly detection:');
  const anomalyQuery = db.prepare(`
    WITH stats AS (
      SELECT 
        location_id,
        AVG(total_sales) as avg_sales,
        AVG(total_sales) * 0.25 as threshold
      FROM sales_daily
      GROUP BY location_id
    )
    SELECT 
      s.date,
      s.location_name,
      ROUND(s.total_sales, 2) as sales,
      ROUND(st.avg_sales, 2) as expected,
      ROUND(((s.total_sales - st.avg_sales) / st.avg_sales) * 100, 1) as deviation_pct
    FROM sales_daily s
    JOIN stats st ON s.location_id = st.location_id
    WHERE ABS(s.total_sales - st.avg_sales) > st.threshold
    ORDER BY ABS(s.total_sales - st.avg_sales) DESC
    LIMIT 10
  `);
  
  const anomalies = anomalyQuery.all();
  anomalies.forEach((a: any) => {
    const direction = a.deviation_pct > 0 ? '📈' : '📉';
    console.log(`  ${direction} ${a.date} - ${a.location_name}: $${a.sales} (${a.deviation_pct > 0 ? '+' : ''}${a.deviation_pct}%)`);
  });
}

main();
