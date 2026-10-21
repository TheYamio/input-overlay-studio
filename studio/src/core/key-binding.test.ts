import { describe, expect, it } from 'vitest';
import { bindingFromCode, bindingFromVK } from './key-binding';
describe('physical key assignment', () => {
  it.each([['Shift', 160, 161], ['Control', 162, 163], ['Alt', 164, 165]] as const)('keeps left/right %s separate in browser and native capture', (name, left, right) => {
    expect(bindingFromCode(`${name}Left`)?.code).toBe(left); expect(bindingFromCode(`${name}Right`)?.code).toBe(right);
    expect(bindingFromVK(left)?.label).toMatch(/^L /); expect(bindingFromVK(right)?.label).toMatch(/^R /);
  });
  it('uses physical Latin positions independently of the typed keyboard layout', () => {
    expect(bindingFromCode('KeyW')).toEqual({ code: 87, label: 'W' }); expect(bindingFromCode('Digit1')?.code).toBe(49);
    expect(bindingFromCode('BracketLeft')?.code).toBe(219); expect(bindingFromCode('Space')?.label).toBe('Space');
  });
  it('keeps numpad digits separate and matches Windows function/navigation codes', () => {
    expect(bindingFromCode('Numpad1')?.code).toBe(97); expect(bindingFromCode('F24')?.code).toBe(135);
    expect(bindingFromVK(97)?.label).toBe('Num 1'); expect(bindingFromCode('ArrowLeft')?.code).toBe(37);
    expect(bindingFromCode('NumpadEnter')?.code).toBe(13);
  });
  it('rejects unrecognized browser keys and out-of-range native codes', () => {
    for (const code of ['', 'Unidentified', 'KeyЖ', 'F25']) expect(bindingFromCode(code)).toBeNull();
    for (const code of [0, -1, 256, 1.5, NaN]) expect(bindingFromVK(code)).toBeNull();
  });
  it('provides an explicit VK name for uncommon native keys', () => { expect(bindingFromVK(254)).toEqual({ code: 254, label: 'VK 254' }); });
});
