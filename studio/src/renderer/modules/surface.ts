import {fontStack,textSpacing} from '../../core/unicode';
import type { OverlayModule } from '../../core/config';
import { rgba } from '../../core/skins';
export function updateSurface(el:HTMLElement,m:OverlayModule){
  if(el.dataset.moduleId!==m.id)el.dataset.moduleId=m.id;
  const classes=`overlay-module module-${m.type} effect-${m.effect.replace(' ', '-').toLowerCase()}`;
  if(el.className!==classes)el.className=classes;
  // Reassigning an identical class/custom property can invalidate an entire
  // keyboard subtree. Read inline styles only; this never forces layout.
  const properties:Record<string,string>={left:`${m.x}px`,top:`${m.y}px`,width:`${m.w}px`,height:`${m.h}px`,opacity:`${m.opacity}`,'z-index':`${m.z}`,display:m.visible?'':'none',
    '--module-accent':m.accent,'--module-bg':rgba(m.background,m.appearance.backgroundOpacity),'--module-radius':`${m.radius}px`,
    '--surface-border':rgba(m.appearance.borderColor,m.appearance.borderOpacity),'--surface-border-width':`${m.appearance.borderWidth}px`,
    '--text-color':m.appearance.textColor,'--font-family':fontStack(m.appearance.fontFamily),'--font-size':`${m.appearance.fontSize}px`,'--font-weight':`${m.appearance.fontWeight}`,
    '--letter-spacing':`${textSpacing(el.textContent??'',m.appearance.letterSpacing)}px`,'--outline':`${m.appearance.textOutline}px`,'--text-shadow':`0 1px ${m.appearance.textShadow}px #000`};
  for(const [name,value] of Object.entries(properties))if(el.style.getPropertyValue(name)!==value)el.style.setProperty(name,value);
  if(el.dataset.textLayout!==m.textLayout)el.dataset.textLayout=m.textLayout;
}
export function fitTextModule(el: HTMLElement, m: OverlayModule) {
  const content = el.querySelector<HTMLElement>('.module-text-content'); if (!content || !m.visible) return;
  el.style.setProperty('--letter-spacing',`${textSpacing(content.textContent??'',m.appearance.letterSpacing)}px`);
  const width = content.scrollWidth, height = content.scrollHeight;
  const availableW = Math.max(1, m.w - 8 - m.appearance.borderWidth * 2), availableH = Math.max(1, m.h - 8 - m.appearance.borderWidth * 2);
  const scale = m.appearance.autoFitText ? Math.min(1, availableW / Math.max(1, width), availableH / Math.max(1, height)) : 1;
  content.style.transform = `scale(${scale})`;
  content.style.top = `${4 + m.appearance.borderWidth + Math.max(0, (availableH - height * scale) / 2)}px`;
  content.style.left = `${4 + m.appearance.borderWidth}px`;
}
