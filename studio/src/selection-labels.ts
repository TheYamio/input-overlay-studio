import type { Key, OverlayModule } from './core/config';
import { bindingFromVK } from './core/key-binding';
import { tr, trText } from './core/localization/messages';

export function keySelectionLabel(key: Key) {
  return key.label.trim() || trText(bindingFromVK(key.code)?.label ?? `VK ${key.code}`);
}

export function mouseButtonBinding(button: number) {
  if (button < 6) return `M${button}`;
  return button === 6 ? tr('ui:s-42cb4e6f8497', 'UP') : tr('ui:s-d45b3383faf6', 'DOWN');
}

export function mouseSelectionLabel(module: OverlayModule, button: number) {
  const binding = mouseButtonBinding(button);
  const caption = module.buttonLabels[button - 1]?.trim();
  return caption && caption !== binding ? `${caption} · ${binding}` : binding;
}
