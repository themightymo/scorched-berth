// Credits and the armory. Prices and caps come from the weapon and defense
// registries (via stockInfo).

import { stockInfo, sanitizeInventory } from '../core/weapons.js';

export const ECONOMY = {
  base: 60,
  perDamage: 1.5,
  perKill: 110,
  survival: 80,
  victory: 180,
  lossFloor: 170, // a defeat always pays at least this, so a loss is recoverable
  maxCredits: 5000,
};

export function battleRewards(stat, outcome) {
  const lines = [
    { label: 'Deployment pay', amount: ECONOMY.base },
    { label: `Damage dealt (${stat.damage})`, amount: Math.round(stat.damage * ECONOMY.perDamage) },
  ];
  if (stat.kills) lines.push({ label: `Eliminations ×${stat.kills}`, amount: stat.kills * ECONOMY.perKill });
  if (stat.survived) lines.push({ label: 'Survival bonus', amount: ECONOMY.survival });
  if (outcome === 'victory') lines.push({ label: 'Victory bonus', amount: ECONOMY.victory });
  let total = lines.reduce((n, l) => n + l.amount, 0);
  if (outcome !== 'victory' && total < ECONOMY.lossFloor) {
    lines.push({ label: 'Field support (loss floor)', amount: ECONOMY.lossFloor - total });
    total = ECONOMY.lossFloor;
  }
  return { lines, total };
}

export function canBuy(credits, inventory, itemId) {
  const it = stockInfo(itemId);
  if (!it) return 'Unknown item.';
  if (it.unlimited) return 'Already unlimited.';
  if ((inventory[itemId] ?? 0) >= it.cap) return `Carry limit reached (${it.cap}).`;
  if (credits < it.price) return `Need ${it.price - credits} more credits.`;
  return null;
}

export function buy(wallet, itemId) {
  const error = canBuy(wallet.credits, wallet.inventory, itemId);
  if (error) return { ok: false, error, ...wallet };
  const inventory = { ...wallet.inventory, [itemId]: (wallet.inventory[itemId] ?? 0) + 1 };
  return { ok: true, credits: wallet.credits - stockInfo(itemId).price, inventory };
}

export const sellPrice = (itemId) => Math.floor((stockInfo(itemId)?.price ?? 0) / 2);

export function sell(wallet, weaponId) {
  const w = stockInfo(weaponId);
  if (!w || w.unlimited) return { ok: false, error: 'Cannot sell that.', ...wallet };
  if ((wallet.inventory[weaponId] ?? 0) <= 0) return { ok: false, error: 'None to sell.', ...wallet };
  const inventory = { ...wallet.inventory, [weaponId]: wallet.inventory[weaponId] - 1 };
  return { ok: true, credits: Math.min(ECONOMY.maxCredits, wallet.credits + sellPrice(weaponId)), inventory };
}

export function clampWallet(credits, inventory) {
  const c = Math.floor(Number(credits));
  return { credits: Number.isFinite(c) ? Math.max(0, Math.min(ECONOMY.maxCredits, c)) : 0, inventory: sanitizeInventory(inventory, { capped: true }) };
}
