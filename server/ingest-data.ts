#!/usr/bin/env node --import tsx
/**
 * Data ingestion script for sales and weather data
 * Pulls from Dripos API and Open-Meteo API
 */

import db from './db.js';
import fetch from 'node-fetch';

const DRIPOS_AUTH_HEADER = 'h9HWy7rifr6aEugowYd5KVZpy6N3J8aY';
const DRIPOS_LOCATION_HEADER = 'loc_zWkTy2JGaXcBRWc5miKaKUjC';

const LOCATIONS = [
  { id: 131, name: 'G1 - Alton' },
  { id: 132, name: 'G2 - Godfrey' },
  { id: 133, name: 'G3 - East Gate' },
  { id: 134, name: 'G4 - Jerseyville' },
];

// Date helpers
function dateToEpoch(dateStr: string): number {
  return Math.floor(new Date(dateStr + 'T00:00:00-06:00').getTime() / 1000);
}

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

// Fetch sales data from Dripos
async function fetchDriposSales(locationId: number, startDate: string, endDate: string) {
  const startEpoch = dateToEpoch(startDate);
  const endEpoch = dateToEpoch(endDate) + 86400; // Include full end date

  const url = 'https://api.dripos.com/report/sales';
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authentication': DRIPOS_AUTH_HEADER,
        'Location': DRIPOS_LOCATION_HEADER,
      },
      body: JSON.stringify({
        START_EPOCH: startEpoch,
        END_EPOCH: endEpoch,
        LOCATION_ID_ARRAY: [locationId],
      }),
    });

    if (!response.ok) {
      throw new Error(`Dripos API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Error fetching sales for location ${locationId}:`, error);
    return null;
  }
}

// Fetch weather data from Open-Meteo
async function fetchWeatherData(startDate: string, endDate: string) {
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=38.89&longitude=-90.18&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,windspeed_10m_max&timezone=America/Chicago`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    return data.daily;
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return null;
  }
}

// Process and store sales data
function storeSalesData(locationId: number, locationName: string, salesData: any) {
  if (!salesData || !salesData.days) {
    console.log(`No sales data to process for ${locationName}`);
    return 0;
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO sales_daily (date, location_id, location_name, total_sales, transaction_count, avg_ticket)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  
  // Process daily sales data from Dripos response
  for (const day of salesData.days || []) {
    const date = new Date(day.date * 1000).toISOString().split('T')[0];
    const totalSales = day.net_sales || 0;
    const transactionCount = day.ticket_count || 0;
    const avgTicket = transactionCount > 0 ? totalSales / transactionCount : 0;
    
    insertStmt.run(date, locationId, locationName, totalSales, transactionCount, avgTicket);
    count++;
  }

  return count;
}

// Store weather data
function storeWeatherData(weatherData: any) {
  if (!weatherData || !weatherData.time) {
    console.log('No weather data to process');
    return 0;
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO weather_daily (date, temp_max, temp_min, precipitation, snowfall, windspeed_max)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  
  for (let i = 0; i < weatherData.time.length; i++) {
    const date = weatherData.time[i];
    const tempMax = weatherData.temperature_2m_max[i];
    const tempMin = weatherData.temperature_2m_min[i];
    const precipitation = weatherData.precipitation_sum[i];
    const snowfall = weatherData.snowfall_sum[i];
    const windspeedMax = weatherData.windspeed_10m_max[i];
    
    insertStmt.run(date, tempMax, tempMin, precipitation, snowfall, windspeedMax);
    count++;
  }

  return count;
}

// Seed historical closure decisions
function seedClosureDecisions() {
  const decisions = [
    { date: '2025-01-18', decision: 'delay', score: 6, road_conditions: 1, temperature: 3, school_closures: 1, wind_speed: 0, ice_severity: 0, weather_duration: 1, emergency_services: 0 },
    { date: '2025-02-19', decision: 'delay', score: 7, road_conditions: 2, temperature: 3, school_closures: 2, wind_speed: 0, ice_severity: 0, weather_duration: 0, emergency_services: 0 },
    { date: '2025-11-28', decision: 'delay', score: 11, road_conditions: 3, temperature: 3, school_closures: 2, wind_speed: 1, ice_severity: 2, weather_duration: 0, emergency_services: 0 },
    { date: '2025-12-01', decision: 'close', score: 12, road_conditions: 3, temperature: 3, school_closures: 3, wind_speed: 1, ice_severity: 2, weather_duration: 0, emergency_services: 0 },
    { date: '2025-12-02', decision: 'delay', score: 8, road_conditions: 2, temperature: 3, school_closures: 2, wind_speed: 0, ice_severity: 0, weather_duration: 1, emergency_services: 0 },
    { date: '2026-01-24', decision: 'early_close', score: 11, road_conditions: 3, temperature: 3, school_closures: 2, wind_speed: 1, ice_severity: 2, weather_duration: 0, emergency_services: 0 },
    { date: '2026-01-25', decision: 'close', score: 11, road_conditions: 3, temperature: 3, school_closures: 3, wind_speed: 1, ice_severity: 0, weather_duration: 2, emergency_services: 0 },
    { date: '2026-01-26', decision: 'delay', score: 11, road_conditions: 2, temperature: 3, school_closures: 2, wind_speed: 1, ice_severity: 2, weather_duration: 1, emergency_services: 0 },
  ];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO closure_decisions 
    (date, decision, score, road_conditions, temperature, school_closures, wind_speed, ice_severity, weather_duration, emergency_services, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const d of decisions) {
    insertStmt.run(
      d.date, d.decision, d.score,
      d.road_conditions, d.temperature, d.school_closures,
      d.wind_speed, d.ice_severity, d.weather_duration,
      d.emergency_services, 'historical_data'
    );
    count++;
  }

  return count;
}

// Main execution
async function main() {
  console.log('🚀 Starting data ingestion...\n');

  // Date ranges
  const today = new Date().toISOString().split('T')[0];
  const start2025 = '2025-01-01';
  const end2026 = today;

  // Fetch and store weather data
  console.log('📡 Fetching weather data from Open-Meteo...');
  const weatherData = await fetchWeatherData(start2025, end2026);
  if (weatherData) {
    const weatherCount = storeWeatherData(weatherData);
    console.log(`✅ Stored ${weatherCount} weather records\n`);
  }

  // Fetch and store sales data for each location
  console.log('📡 Fetching sales data from Dripos API...');
  for (const location of LOCATIONS) {
    console.log(`  Processing ${location.name}...`);
    const salesData = await fetchDriposSales(location.id, start2025, end2026);
    if (salesData) {
      const count = storeSalesData(location.id, location.name, salesData);
      console.log(`  ✅ Stored ${count} sales records for ${location.name}`);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Seed historical closure decisions
  console.log('\n📝 Seeding historical closure decisions...');
  const closureCount = seedClosureDecisions();
  console.log(`✅ Stored ${closureCount} historical closure decisions\n`);

  console.log('✨ Data ingestion complete!');
}

main().catch(console.error);
