-- Sales Anomaly & Weather Closure Tables

CREATE TABLE IF NOT EXISTS sales_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  location_id INTEGER NOT NULL,
  location_name TEXT NOT NULL,
  total_sales REAL NOT NULL,
  transaction_count INTEGER,
  avg_ticket REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, location_id)
);

CREATE TABLE IF NOT EXISTS weather_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  temp_max REAL,
  temp_min REAL,
  precipitation REAL,
  snowfall REAL,
  windspeed_max REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS closure_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('open', 'delay', 'close', 'early_close')),
  score INTEGER NOT NULL,
  road_conditions INTEGER DEFAULT 0,
  temperature INTEGER DEFAULT 0,
  school_closures INTEGER DEFAULT 0,
  wind_speed INTEGER DEFAULT 0,
  ice_severity INTEGER DEFAULT 0,
  weather_duration INTEGER DEFAULT 0,
  emergency_services INTEGER DEFAULT 0,
  notes TEXT,
  decided_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sales_daily_date ON sales_daily(date);
CREATE INDEX IF NOT EXISTS idx_sales_daily_location ON sales_daily(location_id);
CREATE INDEX IF NOT EXISTS idx_weather_daily_date ON weather_daily(date);
CREATE INDEX IF NOT EXISTS idx_closure_decisions_date ON closure_decisions(date);
