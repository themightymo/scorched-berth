// Credits and the armory. Prices and caps come from the weapon registry.

import { getWeapon, sanitizeInventory } from '../core/weapons.js';

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

export function canBuy(credits, inventory, weaponId) {
  const w = getWeapon(weaponId);
  if (!w) return 'Unknown weapon.';
  if (w.ammo.unlimited) return 'Already unlimited.';
  if ((inventory[weaponId] ?? 0) >= w.ammo.cap) return `Carry limit reached (${w.ammo.cap}).`;
  if (credits < w.ammo.price) return `Need ${w.ammo.price - credits} more credits.`;
  return null;
}

export function buy(wallet, weaponId) {
  const error = canBuy(wallet.credits, wallet.inventory, weaponId);
  if (error) return { ok: false, error, ...wallet };
  const w = getWeapon(weaponId);
  const inventory = { ...wallet.inventory, [weaponId]: (wallet.inventory[weaponId] ?? 0) + 1 };
  return { ok: true, credits: wallet.credits - w.ammo.price, inventory };
}

export const sellPrice = (weaponId) => Math.floor((getWeapon(weaponId)?.ammo.price ?? 0) / 2);

export function sell(wallet, weaponId) {
  const w = getWeapon(weaponId);
  if (!w || w.ammo.unlimited) return { ok: false, error: 'Cannot sell that.', ...wallet };
  if ((wallet.inventory[weaponId] ?? 0) <= 0) return { ok: false, error: 'None to sell.', ...wallet };
  const inventory = { ...wallet.inventory, [weaponId]: wallet.inventory[weaponId] - 1 };
  return { ok: true, credits: Math.min(ECONOMY.maxCredits, wallet.credits + sellPrice(weaponId)), inventory };
}

export function clampWallet(credits, inventory) {
  const c = Math.floor(Number(credits));
  return { credits: Number.isFinite(c) ? Math.max(0, Math.min(ECONOMY.maxCredits, c)) : 0, inventory: sanitizeInventory(inventory, { capped: true }) };
}
