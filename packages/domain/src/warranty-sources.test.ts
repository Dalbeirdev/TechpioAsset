import { describe, expect, it } from 'vitest';
import { detectWarrantyVendor, warrantySource } from './warranty-sources';

describe('detectWarrantyVendor', () => {
  it('finds the maker across the fleet register vocabulary', () => {
    // Real strings from the go-live gadget register.
    expect(detectWarrantyVendor('HP Victus')?.vendor).toBe('hp');
    expect(detectWarrantyVendor('Dell', 'Dell Latitude 5420')?.vendor).toBe('dell');
    expect(detectWarrantyVendor('LENOVO ThinkPad P14s Gen 2i')?.vendor).toBe('lenovo');
    expect(detectWarrantyVendor('Acer- Predator Helios 300')?.vendor).toBe('acer');
    expect(detectWarrantyVendor('Lenevo Ideapad')?.vendor).toBe('lenovo'); // typo'd brand, model saves it
    expect(detectWarrantyVendor('MacBook Air, M2')?.vendor).toBe('apple');
    expect(detectWarrantyVendor('Victus by HP 15.6 inch Gaming Laptop PC')?.vendor).toBe('hp');
  });

  it('agent-reported manufacturer is a usable signal on its own', () => {
    expect(detectWarrantyVendor('LENOVO', null, undefined)?.vendor).toBe('lenovo');
  });

  it('does not fire inside longer words', () => {
    expect(detectWarrantyVendor('Sharp monitor')).toBeNull();
    expect(detectWarrantyVendor('Dellington Systems')).toBeNull();
    expect(detectWarrantyVendor('Some Unknown Make')).toBeNull();
  });
});

describe('warrantySource', () => {
  it('Dell resolves the device straight from the URL', () => {
    const src = warrantySource('4TPJBK3', 'Dell');
    expect(src?.serialInUrl).toBe(true);
    expect(src?.url).toContain('/servicetag/4TPJBK3/');
  });

  it('HP links to the official form and flags the serial for copying', () => {
    const src = warrantySource('5CD2403P37', 'HP Victus');
    expect(src?.serialInUrl).toBe(false);
    expect(src?.url).toContain('support.hp.com');
  });

  it('Acer goes to the official support page; the serial travels by clipboard', () => {
    const src = warrantySource('NHQC1SI00714724D683400', 'Acer- Predator Helios 300');
    expect(src?.vendor).toBe('acer');
    expect(src?.serialInUrl).toBe(false);
  });

  it('a missing serial degrades to the lookup form, never a broken URL', () => {
    const src = warrantySource(null, 'Dell Latitude');
    expect(src?.serialInUrl).toBe(false);
    expect(src?.url).not.toContain('servicetag//');
  });

  it('unknown makers produce no source rather than a guess', () => {
    expect(warrantySource('X1', 'Frontech')).toBeNull();
  });
});
