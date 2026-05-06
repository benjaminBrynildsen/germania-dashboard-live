import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Ingredient {
  name: string;
  apPackCost: number;
  packSize: number;
  packUnit: string;
  unitConversion: number;
  apPrice: number;
  apPriceUnit: string;
  yieldPercent: number;
  epPrice: number;
  epPriceUnit: string;
  quantityUsed?: number;
}

interface Recipe {
  sheetId: string;
  season: string;
  tabName: string;
  format: string;
  name: string;
  category: string | null;
  totalYield: number;
  yieldUnit: string;
  ingredients: Ingredient[];
  labor: {
    timeHrs: number | null;
    quantity?: number;
    cookRate?: number;
    costPerUnit?: number;
  };
}

interface CogData {
  extractedAt: string;
  totalRecipes: number;
  totalErrors: number;
  errors: any[];
  recipes: Recipe[];
}

export function seedCogData() {
  const dataPath = path.join(__dirname, '../../.openclaw/workspace-wolfgang/germania-cog-data.json');
  
  if (!fs.existsSync(dataPath)) {
    throw new Error(`COG data file not found at ${dataPath}`);
  }

  const rawData = fs.readFileSync(dataPath, 'utf-8');
  const cogData: CogData = JSON.parse(rawData);

  // Clear existing data
  db.prepare('DELETE FROM cog_ingredients').run();
  db.prepare('DELETE FROM cog_recipes').run();
  db.prepare('DELETE FROM cog_ingredient_master').run();

  console.log(`Seeding ${cogData.recipes.length} recipes...`);

  const insertRecipe = db.prepare(`
    INSERT INTO cog_recipes (
      name, season, category, total_yield, yield_unit,
      labor_time_hrs, labor_quantity, labor_cook_rate, labor_cost_per_unit,
      sheet_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertIngredient = db.prepare(`
    INSERT INTO cog_ingredients (
      recipe_id, name, ap_pack_cost, pack_size, pack_unit,
      unit_conversion, ap_price, ap_price_unit, yield_percent,
      ep_price, ep_price_unit, quantity_used, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMaster = db.prepare(`
    INSERT OR IGNORE INTO cog_ingredient_master (name, ap_pack_cost, pack_size, pack_unit)
    VALUES (?, ?, ?, ?)
  `);

  const updateMaster = db.prepare(`
    UPDATE cog_ingredient_master
    SET ap_pack_cost = ?, pack_size = ?, pack_unit = ?, last_updated = datetime('now')
    WHERE name = ? AND (ap_pack_cost != ? OR pack_size != ? OR pack_unit != ?)
  `);

  // Collect unique ingredients for master list
  const masterIngredients = new Map<string, Ingredient>();

  let recipeCount = 0;
  let ingredientCount = 0;

  for (const recipe of cogData.recipes) {
    // Only import batch_recipe format for now
    if (recipe.format !== 'batch_recipe') {
      continue;
    }

    // Insert recipe
    const result = insertRecipe.run(
      recipe.name,
      recipe.season,
      recipe.category,
      recipe.totalYield,
      recipe.yieldUnit,
      recipe.labor?.timeHrs,
      recipe.labor?.quantity,
      recipe.labor?.cookRate,
      recipe.labor?.costPerUnit,
      recipe.sheetId
    );

    const recipeId = result.lastInsertRowid;
    recipeCount++;

    // Insert ingredients
    recipe.ingredients.forEach((ing, index) => {
      insertIngredient.run(
        recipeId,
        ing.name,
        ing.apPackCost,
        ing.packSize,
        ing.packUnit,
        ing.unitConversion,
        ing.apPrice,
        ing.apPriceUnit,
        ing.yieldPercent,
        ing.epPrice,
        ing.epPriceUnit,
        ing.quantityUsed || null,
        index
      );
      ingredientCount++;

      // Track for master list (use most recent price info)
      const key = ing.name.toLowerCase().trim();
      if (!masterIngredients.has(key) || ing.apPackCost > 0) {
        masterIngredients.set(key, ing);
      }
    });
  }

  // Insert master ingredients
  let masterCount = 0;
  for (const [key, ing] of masterIngredients) {
    insertMaster.run(ing.name, ing.apPackCost, ing.packSize, ing.packUnit);
    masterCount++;
  }

  console.log(`✓ Seeded ${recipeCount} recipes`);
  console.log(`✓ Seeded ${ingredientCount} ingredients`);
  console.log(`✓ Seeded ${masterCount} master ingredients`);

  return {
    success: true,
    recipeCount,
    ingredientCount,
    masterCount,
  };
}
