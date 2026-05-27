export interface MenuSeason {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  categories: MenuCategory[];
  lists: MenuList[];
}

export interface MenuCategory {
  id: number;
  seasonId: number;
  name: string;
  subtitle: string | null;
  position: number;
  side: 'front' | 'back';
  items: MenuItem[];
}

export interface MenuItem {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  kind: 'drink' | 'food';
  position: number;
  sizeLabels: string[] | null;
  prices: string[] | null;
  temps: string | null;
  hasSpotify: boolean;
  frozenNote: string | null;
  layout: 'full' | 'half';
  pairPosition: 'left' | 'right' | null;
  foodPrice: string | null;
  foodSubtitle: string | null;
  isNew: boolean;
  locations: MenuItemLocation[];
}

export interface MenuItemLocation {
  location: string;
  priceOverride: string | null;
}

export interface MenuList {
  id: number;
  seasonId: number;
  name: string;
  position: number;
  side: 'front' | 'back';
  items: MenuListItem[];
}

export interface MenuListItem {
  id: number;
  listId: number;
  name: string;
  position: number;
}

export type MenuFormat = '24x36' | '18x48';
export type Location = 'G1' | 'G2' | 'G3' | 'G4';

export const LOCATIONS: { key: Location; name: string; format: MenuFormat }[] = [
  { key: 'G1', name: 'Alton', format: '24x36' },
  { key: 'G2', name: 'Godfrey', format: '24x36' },
  { key: 'G3', name: 'East Alton', format: '24x36' },
  { key: 'G4', name: 'Jerseyville', format: '18x48' },
];

export const DEFAULT_DRINK_CATEGORIES = [
  { name: 'Sweet Coffee', subtitle: 'Delightfully Sweet', side: 'front' as const },
  { name: 'Bridge Coffee', subtitle: 'Balanced', side: 'front' as const },
  { name: 'Artisanal Coffee', subtitle: 'Coffee-Centric', side: 'front' as const },
  { name: 'Tea, Smoothies, & More', subtitle: null, side: 'back' as const },
];

export const DEFAULT_LISTS = [
  { name: 'More Coffee', side: 'front' as const },
  { name: 'Cold Foam', side: 'front' as const },
  { name: 'Add-Ons', side: 'front' as const },
];
