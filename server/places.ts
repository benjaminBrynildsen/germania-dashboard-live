import db from './db.js';

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places';

interface PlaceReview {
  name: string;
  relativePublishTimeDescription: string;
  rating: number;
  text?: { text: string };
  authorAttribution: {
    displayName: string;
    photoUri?: string;
  };
  publishTime: string;
}

interface PlaceDetails {
  rating?: number;
  userRatingCount?: number;
  reviews?: PlaceReview[];
  googleMapsUri?: string;
}

/**
 * Search Google Places by text to find a Place ID for a location.
 */
async function searchPlaceId(query: string, apiKey: string): Promise<{ placeId: string; mapsUri: string } | null> {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.googleMapsUri,places.displayName',
      },
      body: JSON.stringify({ textQuery: query }),
    });

    if (!res.ok) {
      console.error(`[PlaceSearch] API error for "${query}":`, res.status, await res.text());
      return null;
    }

    const data = await res.json();
    if (data.places && data.places.length > 0) {
      const place = data.places[0];
      return { placeId: place.id, mapsUri: place.googleMapsUri || '' };
    }
    return null;
  } catch (err) {
    console.error(`[PlaceSearch] Failed for "${query}":`, err);
    return null;
  }
}

/**
 * Auto-discover Google Place IDs for all locations that don't have one yet.
 * Uses the Text Search API to find each location by "name address".
 */
export async function discoverPlaceIds(): Promise<void> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return;

  const locations = db.prepare('SELECT id, name, address FROM locations WHERE google_place_id IS NULL').all() as any[];
  if (locations.length === 0) {
    console.log('[PlaceSearch] All locations already have Place IDs.');
    return;
  }

  console.log(`[PlaceSearch] Discovering Place IDs for ${locations.length} location(s)...`);

  for (const loc of locations) {
    const query = `Germania Brew Haus ${loc.address}`;
    const result = await searchPlaceId(query, apiKey);

    if (result) {
      db.prepare(
        'UPDATE locations SET google_place_id = ?, google_maps_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(result.placeId, result.mapsUri, loc.id);
      console.log(`[PlaceSearch] ${loc.name} → ${result.placeId}`);
    } else {
      console.warn(`[PlaceSearch] Could not find Place ID for ${loc.name} (${loc.address})`);
    }
  }
}

/**
 * Fetch reviews from Google Places API (New) for a single location.
 * Requires GOOGLE_PLACES_API_KEY in .env and a valid google_place_id on the location row.
 */
export async function fetchPlaceReviews(locationId: string): Promise<{ synced: number; error?: string }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { synced: 0, error: 'GOOGLE_PLACES_API_KEY not configured' };
  }

  const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(locationId) as any;
  if (!loc) return { synced: 0, error: 'Location not found' };
  if (!loc.google_place_id) return { synced: 0, error: 'No google_place_id set for this location' };

  try {
    const res = await fetch(`${PLACES_API_BASE}/${loc.google_place_id}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'rating,userRatingCount,reviews,googleMapsUri',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Places API error for ${locationId}:`, res.status, body);
      return { synced: 0, error: `API returned ${res.status}` };
    }

    const data: PlaceDetails = await res.json();

    // Update location rating & maps URL
    if (data.rating || data.userRatingCount || data.googleMapsUri) {
      db.prepare(`
        UPDATE locations
        SET google_rating = COALESCE(?, google_rating),
            review_count = COALESCE(?, review_count),
            google_maps_url = COALESCE(?, google_maps_url),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(data.rating ?? null, data.userRatingCount ?? null, data.googleMapsUri ?? null, locationId);
    }

    // Upsert reviews
    if (data.reviews && data.reviews.length > 0) {
      const upsert = db.prepare(`
        INSERT INTO google_reviews (location_id, google_review_id, author, author_photo, rating, text, date, relative_date, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(location_id, google_review_id) DO UPDATE SET
          rating = excluded.rating,
          text = excluded.text,
          relative_date = excluded.relative_date,
          fetched_at = CURRENT_TIMESTAMP
      `);

      const txn = db.transaction(() => {
        for (const review of data.reviews!) {
          upsert.run(
            locationId,
            review.name, // unique review resource name
            review.authorAttribution.displayName,
            review.authorAttribution.photoUri ?? null,
            review.rating,
            review.text?.text ?? '',
            review.publishTime,
            review.relativePublishTimeDescription,
          );
        }
      });
      txn();

      return { synced: data.reviews.length };
    }

    return { synced: 0 };
  } catch (err: any) {
    console.error(`Failed to fetch reviews for ${locationId}:`, err);
    return { synced: 0, error: err.message };
  }
}

// In-memory cache: place_id → photoName. Photo "name" returned by Google
// Places (e.g. places/<id>/photos/<id>) is stable for a place, but the
// /media call is what actually returns image bytes — we cache the name to
// avoid the place-details lookup on every photo request.
const photoNameCache = new Map<string, { name: string; fetchedAt: number }>();
const PHOTO_NAME_TTL_MS = 24 * 60 * 60 * 1000;

async function lookupPlacePhotoName(placeId: string, apiKey: string): Promise<string | null> {
  const cached = photoNameCache.get(placeId);
  if (cached && Date.now() - cached.fetchedAt < PHOTO_NAME_TTL_MS) return cached.name;

  const res = await fetch(`${PLACES_API_BASE}/${placeId}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'photos' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const name = data?.photos?.[0]?.name;
  if (!name) return null;
  photoNameCache.set(placeId, { name, fetchedAt: Date.now() });
  return name;
}

/**
 * Fetch a storefront photo for a location and stream it back. Resolves to
 * { contentType, bytes } or null if no photo is available. Caller is
 * responsible for setting response headers and writing the body.
 */
export async function fetchLocationPhoto(
  placeId: string,
  maxWidthPx = 800,
): Promise<{ contentType: string; bytes: Buffer } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;
  const photoName = await lookupPlacePhotoName(placeId, apiKey);
  if (!photoName) return null;

  const url = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${apiKey}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const contentType = r.headers.get('content-type') || 'image/jpeg';
  const bytes = Buffer.from(await r.arrayBuffer());
  return { contentType, bytes };
}

/**
 * Sync reviews for all locations that have a google_place_id.
 */
export async function syncAllReviews(): Promise<Record<string, { synced: number; error?: string }>> {
  const locations = db.prepare('SELECT id FROM locations WHERE google_place_id IS NOT NULL').all() as any[];
  const results: Record<string, { synced: number; error?: string }> = {};

  for (const loc of locations) {
    results[loc.id] = await fetchPlaceReviews(loc.id);
  }

  console.log('[ReviewSync]', new Date().toISOString(), results);
  return results;
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start daily review sync. Runs once on startup, then every 24 hours.
 * Google Places API returns the 5 most recent reviews per location.
 * Duplicates are ignored via ON CONFLICT — over time this builds a full history.
 */
export function startReviewSync(intervalMs: number = 24 * 60 * 60 * 1000) {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.log('[ReviewSync] No GOOGLE_PLACES_API_KEY — auto-sync disabled. Using demo data.');
    return;
  }

  // On startup: discover Place IDs if needed, then sync reviews
  setTimeout(async () => {
    await discoverPlaceIds();
    console.log('[ReviewSync] Running initial sync...');
    await syncAllReviews();
  }, 5000);

  // Then once per day
  syncInterval = setInterval(() => {
    console.log('[ReviewSync] Running daily sync...');
    syncAllReviews();
  }, intervalMs);

  console.log('[ReviewSync] Daily auto-sync enabled. Next sync in 5s, then every 24h.');
}

export function stopReviewSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
