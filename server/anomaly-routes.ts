import { Router, Response } from 'express';
import db from './db.js';
import { requireAuth, AuthRequest } from './auth.js';

const router = Router();

// Get sales data with optional date range and location filter
router.get('/sales', (req: any, res: Response) => {
  const { startDate, endDate, locationId } = req.query;
  
  let query = 'SELECT * FROM sales_daily WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }
  if (locationId) {
    query += ' AND location_id = ?';
    params.push(locationId);
  }
  
  query += ' ORDER BY date DESC';
  
  const sales = db.prepare(query).all(...params);
  res.json(sales);
});

// Get weather data with optional date range
router.get('/weather', (req: any, res: Response) => {
  const { startDate, endDate } = req.query;
  
  let query = 'SELECT * FROM weather_daily WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }
  
  query += ' ORDER BY date DESC';
  
  const weather = db.prepare(query).all(...params);
  res.json(weather);
});

// Get detected anomalies with tags
router.get('/anomalies', (req: any, res: Response) => {
  const { startDate, endDate, locationId } = req.query;
  
  // Calculate anomalies: sales that deviate >40% from monthly day-of-week average + location
  // Example: Jan Mondays are compared against average of Jan Mondays for that location.
  let query = `
    WITH month_dow_stats AS (
      SELECT 
        location_id,
        strftime('%Y-%m', date) as year_month,
        CAST(strftime('%w', date) AS INTEGER) as dow,
        AVG(total_sales) as avg_sales
      FROM sales_daily
      GROUP BY location_id, strftime('%Y-%m', date), CAST(strftime('%w', date) AS INTEGER)
    ),
    anomalies AS (
      SELECT 
        s.id,
        s.date,
        s.location_id,
        s.location_name,
        s.total_sales as actual,
        ROUND(ms.avg_sales, 2) as expected,
        ROUND(((s.total_sales - ms.avg_sales) / ms.avg_sales) * 100, 1) as deviation_pct,
        s.transaction_count,
        s.avg_ticket
      FROM sales_daily s
      JOIN month_dow_stats ms ON s.location_id = ms.location_id 
        AND strftime('%Y-%m', s.date) = ms.year_month
        AND CAST(strftime('%w', s.date) AS INTEGER) = ms.dow
      WHERE ABS(s.total_sales - ms.avg_sales) > (ms.avg_sales * 0.40)
    )
    SELECT 
      a.*,
      w.snowfall,
      w.temp_min,
      w.precipitation,
      c.decision as closure_decision
    FROM anomalies a
    LEFT JOIN weather_daily w ON a.date = w.date
    LEFT JOIN closure_decisions c ON a.date = c.date
    WHERE 1=1
  `;
  
  const params: any[] = [];
  
  if (startDate) {
    query += ' AND a.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND a.date <= ?';
    params.push(endDate);
  }
  if (locationId) {
    query += ' AND a.location_id = ?';
    params.push(locationId);
  }
  
  query += ' ORDER BY ABS(a.deviation_pct) DESC';
  
  const anomalies = db.prepare(query).all(...params) as any[];
  
  // Add tags to each anomaly
  const enriched = anomalies.map(a => {
    const tags: string[] = [];
    
    if (a.snowfall > 1) tags.push('snow');
    if (a.temp_min < 20) tags.push('weather');
    if (a.closure_decision) tags.push('school');
    
    // Check if date is near a holiday
    const date = new Date(a.date);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    if (
      (month === 12 && day >= 20) || // Christmas week
      (month === 1 && day === 1) || // New Year
      (month === 7 && day === 4) || // July 4
      (month === 11 && day >= 24 && day <= 28) || // Thanksgiving
      (month === 2 && day === 14) || // Valentine's
      (month === 3 && day === 17) // St. Patrick's
    ) {
      tags.push('holiday');
    }
    
    if (tags.length === 0) tags.push('unknown');
    
    return { ...a, tags };
  });
  
  res.json(enriched);
});

// Get closure decisions
router.get('/closures', (_req: any, res: Response) => {
  const closures = db.prepare(`
    SELECT * FROM closure_decisions ORDER BY date DESC
  `).all();
  res.json(closures);
});

// Create new closure decision
router.post('/closures', (req: any, res: Response) => {
  const {
    date,
    decision,
    road_conditions = 0,
    temperature = 0,
    school_closures = 0,
    wind_speed = 0,
    ice_severity = 0,
    weather_duration = 0,
    emergency_services = 0,
    notes = '',
  } = req.body;
  
  // Calculate total score
  const score = 
    road_conditions + 
    temperature + 
    school_closures + 
    wind_speed + 
    ice_severity + 
    weather_duration + 
    emergency_services;
  
  const result = db.prepare(`
    INSERT INTO closure_decisions 
    (date, decision, score, road_conditions, temperature, school_closures, 
     wind_speed, ice_severity, weather_duration, emergency_services, notes, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, decision, score,
    road_conditions, temperature, school_closures,
    wind_speed, ice_severity, weather_duration,
    emergency_services, notes, req.user?.name || 'Unknown'
  );
  
  const closure = db.prepare('SELECT * FROM closure_decisions WHERE id = ?').get(result.lastInsertRowid);
  res.json(closure);
});

// Get anomaly summary stats
router.get('/anomalies/summary', (req: any, res: Response) => {
  const { startDate, endDate, locationId } = req.query;
  
  let whereClause = 'WHERE 1=1';
  const params: any[] = [];
  
  if (startDate) {
    whereClause += ' AND date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    whereClause += ' AND date <= ?';
    params.push(endDate);
  }
  if (locationId) {
    whereClause += ' AND location_id = ?';
    params.push(locationId);
  }
  
  const query = `
    WITH month_dow_stats AS (
      SELECT 
        location_id,
        strftime('%Y-%m', date) as year_month,
        CAST(strftime('%w', date) AS INTEGER) as dow,
        AVG(total_sales) as avg_sales
      FROM sales_daily
      GROUP BY location_id, strftime('%Y-%m', date), CAST(strftime('%w', date) AS INTEGER)
    ),
    anomalies AS (
      SELECT 
        s.date,
        s.location_id,
        s.total_sales,
        ms.avg_sales,
        ((s.total_sales - ms.avg_sales) / ms.avg_sales) * 100 as deviation_pct
      FROM sales_daily s
      JOIN month_dow_stats ms ON s.location_id = ms.location_id
        AND strftime('%Y-%m', s.date) = ms.year_month
        AND CAST(strftime('%w', s.date) AS INTEGER) = ms.dow
      WHERE ABS(s.total_sales - ms.avg_sales) > (ms.avg_sales * 0.40)
    )
    SELECT 
      COUNT(*) as total_anomalies,
      MAX(deviation_pct) as biggest_spike,
      MIN(deviation_pct) as biggest_drop
    FROM anomalies
    ${whereClause}
  `;
  
  const summary = db.prepare(query).get(...params);
  res.json(summary);
});

// Fetch weather forecast for a given date (auto-fill closure calculator)
router.get('/forecast/:date', async (_req: any, res: Response) => {
  const dateStr = _req.params.date; // YYYY-MM-DD
  try {
    // Use Open-Meteo forecast API (free, no key)
    const today = new Date();
    const target = new Date(dateStr + 'T12:00:00');
    const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    let url: string;
    if (diffDays <= 0) {
      // Historical or today — use archive API
      url = `https://archive-api.open-meteo.com/v1/archive?latitude=38.89&longitude=-90.18&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,windspeed_10m_max&hourly=snowfall&timezone=America/Chicago`;
    } else {
      // Future — use forecast API
      url = `https://api.open-meteo.com/v1/forecast?latitude=38.89&longitude=-90.18&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,windspeed_10m_max&hourly=snowfall&timezone=America/Chicago`;
    }
    
    const resp = await fetch(url);
    const data = await resp.json() as any;
    
    if (!data.daily) {
      res.status(400).json({ error: 'No forecast data available for this date' });
      return;
    }
    
    const d = data.daily;
    const tempMin = d.temperature_2m_min?.[0] ?? null;
    const tempMax = d.temperature_2m_max?.[0] ?? null;
    const snowfall = d.snowfall_sum?.[0] ?? 0; // cm
    const snowInches = snowfall / 2.54;
    const windMax = d.windspeed_10m_max?.[0] ?? 0; // km/h
    const windMph = windMax * 0.621371;
    const precip = d.precipitation_sum?.[0] ?? 0;
    
    // Convert temp C to F
    const tempMinF = tempMin !== null ? tempMin * 9/5 + 32 : null;
    const tempMaxF = tempMax !== null ? tempMax * 9/5 + 32 : null;
    
    // Figure out when snow ends from hourly data
    let lastSnowHour = -1;
    if (data.hourly?.snowfall) {
      for (let i = data.hourly.snowfall.length - 1; i >= 0; i--) {
        if (data.hourly.snowfall[i] > 0) {
          lastSnowHour = i;
          break;
        }
      }
    }
    
    // Auto-score based on forecast
    // Road conditions from snowfall
    let roadConditions = 0;
    if (snowInches >= 4) roadConditions = 3;
    else if (snowInches >= 2) roadConditions = 2;
    else if (snowInches >= 0.5) roadConditions = 1;
    
    // Temperature scoring
    let temperature = 0;
    if (tempMinF !== null) {
      if (tempMinF < 0) temperature = 2;
      else if (tempMinF < 20) temperature = 2;
      else if (tempMinF < 32) temperature = 3;
    }
    
    // Wind speed
    let windSpeedScore = windMph >= 20 ? 1 : 0;
    
    // Ice severity (rain + freezing temps)
    let iceSeverity = 0;
    if (precip > 0 && tempMinF !== null && tempMinF < 32) {
      if (precip > 10) iceSeverity = 4;
      else if (precip > 2) iceSeverity = 2;
    }
    
    // Weather duration from hourly snowfall
    let weatherDuration = 0;
    if (lastSnowHour >= 0) {
      if (lastSnowHour >= 18) weatherDuration = 4;      // past 6PM
      else if (lastSnowHour >= 12) weatherDuration = 3;  // past noon
      else if (lastSnowHour >= 7) weatherDuration = 2;   // 7AM-noon
      else weatherDuration = 1;                           // before 7AM
    }
    
    res.json({
      date: dateStr,
      raw: {
        tempMinF: tempMinF !== null ? Math.round(tempMinF) : null,
        tempMaxF: tempMaxF !== null ? Math.round(tempMaxF) : null,
        snowInches: Math.round(snowInches * 10) / 10,
        windMph: Math.round(windMph),
        precipMm: Math.round(precip * 10) / 10,
        lastSnowHour,
      },
      suggested: {
        road_conditions: roadConditions,
        temperature,
        wind_speed: windSpeedScore,
        ice_severity: iceSeverity,
        weather_duration: weatherDuration,
        // These can't be auto-detected:
        school_closures: 0,
        emergency_services: 0,
      },
      summary: `${Math.round(tempMinF ?? 0)}°F - ${Math.round(tempMaxF ?? 0)}°F | Snow: ${Math.round(snowInches * 10) / 10}" | Wind: ${Math.round(windMph)}mph`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch forecast' });
  }
});

export default router;
