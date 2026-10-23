import {fontStack,graphemes,textSpacing} from '../../core/unicode';
import { animationFields, animationSettings, easingCss, PressTimeline } from '../../core/animation';
import { inputPreview,previewDepth,type PreviewState } from '../../core/preview';
import type { OverlayModule,StudioDocument } from '../../core/config';
import type { InputEvent } from '../../core/input';
import { capsFor,imagePlacement,resolvedStyle,rgba,tilePlane,type Cap } from '../../core/skins';
import type { ModuleContext,ModuleFrame,ModuleUpdate,VisualFactory,VisualInstance } from './contracts';
type Control = { el: HTMLElement; code: number; mouse: boolean; previous: number; flashUntil: number; wheelMs: number; flashing: boolean; modern: boolean; timeline: PressTimeline; timing: ReturnType<typeof animationSettings> };

class CapRuntime implements VisualInstance {
 private document!:StudioDocument;private module?:OverlayModule;
 private controls:Control[]=[];private controlByElement=new WeakMap<HTMLElement,Control>();
 private signature='';private placementSignature='';private assetData?:string;private locale='';
 private textMetrics=new Map<string,{width:number;height:number}>();
 private previewState=inputPreview();private previewActive=false;private animationDeadline=Infinity;
 constructor(private context:ModuleContext){}
 private get engine(){return this.context.engine;}
 private get measure(){return this.context.resources.measure;}
 private overridden(_element?:HTMLElement){return this.previewActive&&this.previewState.mode!=='Input';}
 update(state:ModuleUpdate){
  if(this.locale!==state.profile.locale){this.textMetrics.clear();this.locale=state.profile.locale;}
  const m=state.module;this.module=m;const el=this.context.element;this.document=state.document;
  // Translation changes a shared picture's origin, not key text, shapes or
  // animation settings. Keep those updates separate to preserve cap DOM/state.
  const signature=JSON.stringify([{...m,x:0,y:0},this.locale,state.document.performance.glowQuality,this.context.resources.shapeVersion]),assetData=state.document.assets[m.image.assetId]?.data;
  const placementSignature=m.image.groupId?JSON.stringify([m.x,m.y,this.artworkRegion(m)]):'';
  if(this.signature!==signature||this.assetData!==assetData){
   if(!el.querySelector('.cap-layout')){const group=document.createElement('div');group.className='cap-layout';el.append(group);}
   this.context.resources.begin();this.renderCaps(el,m);this.context.resources.end();this.controls=this.controls.filter(control=>el.contains(control.el));this.signature=signature;this.assetData=assetData;
  }else if(this.placementSignature!==placementSignature){
   const {caps,w,h}=capsFor(m),keys=new Map([...el.querySelectorAll<HTMLElement>('.overlay-key')].map(key=>[key.dataset.capId,key]));
   for(const cap of caps){const key=keys.get(cap.id);if(key)this.texture(key,cap,m,w,h);}
  }
  this.placementSignature=placementSignature;
 }
 preview(state:PreviewState,active:boolean){if(state.mode!==this.previewState.mode||active!==this.previewActive)for(const control of this.controls){control.timeline.reset();control.previous=-1;control.flashUntil=0;}this.previewState=state;this.previewActive=active;}
 input(e:InputEvent,now:number){
    for (const control of this.controls) {
      if (e.event_type === 'input_reset' || e.event_type === 'state_restored') {
        control.flashUntil = 0; control.el.classList.remove('tap-flash'); control.flashing = false;
        control.timeline.reset(e.event_type === 'input_reset' ? 0 : control.mouse ? this.engine.buttons[control.code] : this.engine.keys[control.code]); control.previous = -1;
      }
      if (this.overridden(control.el)) continue;
      const matches = ('rawcode' in e && !control.mouse && e.rawcode === control.code) || ('button' in e && control.mouse && e.button === control.code) || (e.event_type === 'mouse_wheel' && control.mouse && control.code >= 6);
      if (!matches) continue;
      if (control.modern) control.timeline.input(control.mouse ? this.engine.buttons[control.code] : this.engine.keys[control.code], now, control.timing.pressDelay, control.timing.releaseDelay);
      else if (e.event_type === 'key_pressed' || e.event_type === 'mouse_pressed') control.flashUntil = now + 65;
    }
 }
 frame({now,dirty,inputChanged,wheelActive}:ModuleFrame){
    if (inputChanged || dirty || wheelActive || now >= this.animationDeadline) {
      let deadline = Infinity;
      for (const control of this.controls) {
        const input = this.overridden(control.el) ? previewDepth(this.previewState, control.mouse, control.code)! : control.mouse ? (control.code >= 6 && now - this.engine.lastWheel >= control.wheelMs ? 0 : this.engine.buttons[control.code]) : this.engine.keys[control.code];
        let value = input;
        if (control.modern) {
          control.timeline.input(input, now, control.timing.pressDelay, control.timing.releaseDelay);
          value = control.timeline.advance(now); deadline = Math.min(deadline, control.timeline.deadline);
        }
        if (value === control.previous) continue;
        control.el.classList.toggle('pressed', value > 0); control.el.style.setProperty('--depth', `${value * 100}%`); control.previous = value;
      }
      this.animationDeadline = deadline;
    }
    let animate = false;
    for (const control of this.controls) { const flash = !control.modern && !this.overridden(control.el) && control.flashUntil > now && !control.el.classList.contains('pressed'); if (flash !== control.flashing) { control.el.classList.toggle('tap-flash', flash); control.flashing = flash; } animate ||= !this.overridden(control.el) && control.flashUntil > now; }
  return {animate,deadline:this.animationDeadline};
 }
 private assetUrl(id:string){return this.context.resources.assetUrl(id);}
 private shapeMask(id:string,border?:{width:number;height:number;thickness:number}){return this.context.resources.shapeMask(id,border);}
 private artworkRegion(m:OverlayModule){return this.context.resources.artworkRegion(m);}
  private renderCaps(el: HTMLElement, m: OverlayModule) {
    const group = el.querySelector<HTMLElement>('.cap-layout')!, { caps, w, h } = capsFor(m);
    const scale = Math.min(m.w / w, m.h / h);
    Object.assign(group.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${scale})` });
    group.classList.toggle('mouse-diagram', m.type === 'mouse' && m.mouseMode === 'Mouse Diagram');
    let outline = group.querySelector<SVGElement>('.mouse-outline');
    const bodyShape = m.mouseBodyShapeId && this.document.shapes[m.mouseBodyShapeId];
    let body = group.querySelector<HTMLElement>('.mouse-custom-body');
    if (bodyShape && m.type === 'mouse' && m.mouseMode === 'Mouse Diagram') {
      outline?.remove();
      if (!body) { body = document.createElement('div'); body.className = 'mouse-custom-body'; group.prepend(body); }
      body.style.maskImage = this.shapeMask(m.mouseBodyShapeId!);
      body.style.webkitMaskImage = this.shapeMask(m.mouseBodyShapeId!);
      body.style.setProperty('--body-border', m.appearance.borderWidth ? this.shapeMask(m.mouseBodyShapeId!, { width: 220, height: 300, thickness: m.appearance.borderWidth }) : 'none');
      body.style.setProperty('--body-border-color', rgba(m.appearance.borderColor, m.appearance.borderWidth ? m.appearance.borderOpacity : 0));
    } else body?.remove();
    if (!bodyShape && m.type === 'mouse' && m.mouseMode === 'Mouse Diagram') {
      if (!outline) {
        outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); outline.classList.add('mouse-outline'); outline.setAttribute('viewBox', '0 0 220 300');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M110 4 C42 4 6 45 6 119 L6 207 C6 267 42 296 110 296 C178 296 214 267 214 207 L214 119 C214 45 178 4 110 4 Z'); outline.append(path); group.prepend(outline);
      }
    } else outline?.remove();
    const ids = new Set(caps.map(k => k.id));
    const keys = new Map([...group.querySelectorAll<HTMLElement>('.overlay-key')].map(key => [key.dataset.capId!, key]));
    for (const [id, child] of keys) if (!ids.has(id)) child.remove();
    for (const cap of caps) {
      let key = keys.get(cap.id);
      if (!key) {
        key = document.createElement('div'); key.className = 'overlay-key'; key.dataset.capId = cap.id;
        const surface = document.createElement('div'); surface.className = 'key-surface';
        const active = document.createElement('div'); active.className = 'key-active'; surface.append(active);
        const label = document.createElement('span'); label.className = 'key-label';label.dir='auto';
        const body = document.createElement('div'); body.className = 'key-body'; body.append(surface, label); key.append(body); group.append(key);
        const control: Control = { el: key, code: cap.code, mouse: m.type === 'mouse', previous: -1, flashUntil: 0, wheelMs: m.wheelDuration, flashing: false, modern: false, timeline: new PressTimeline(), timing: animationSettings({}) };
        this.controls.push(control); this.controlByElement.set(key, control);
      }
      const control = this.controlByElement.get(key)!; control.code = cap.code; control.wheelMs = m.wheelDuration;
      if (m.type === 'mouse') key.dataset.button = `${cap.code}`; else key.dataset.key = `${cap.code}`;
      key.querySelector('.key-label')!.textContent = cap.label;
      Object.assign(key.style, { position: 'absolute', left: `${cap.x}px`, top: `${cap.y}px`, width: `${cap.w}px`, height: `${cap.h}px` });
      const style = resolvedStyle(m, cap.style), timing = animationSettings(style);
      const modern = animationFields.some(field => style[field] !== undefined);
      if (modern !== control.modern) { control.timeline.reset(Math.max(0, control.previous)); control.previous = -1; control.flashUntil = 0; key.classList.remove('tap-flash'); }
      control.modern = modern; control.timing = timing;
      key.dataset.lighting = timing.lighting; key.dataset.motion = timing.motion;
      const glow = this.document.performance.glowQuality === 'Off' ? 0 : this.document.performance.glowQuality === 'Low' ? Math.min(style.glowStrength, 12) : style.glowStrength;
      key.style.setProperty('--press-ms', `${timing.pressMs}ms`); key.style.setProperty('--release-ms', `${timing.releaseMs}ms`);
      key.style.setProperty('--motion-easing', easingCss[timing.easing]); key.style.setProperty('--motion-scale', `${timing.motionScale}`);
      key.style.setProperty('--light-opacity', `${timing.lightingOpacity}`); key.style.setProperty('--secondary-light', timing.secondaryColor); key.style.setProperty('--gradient-angle', `${timing.gradientAngle}deg`);
      key.style.setProperty('--light-glow', `${glow}px`);

      key.querySelector<HTMLElement>('.key-label')!.hidden = !style.showLabels;
      const shape = this.document.shapes[style.shapeId];
      key.classList.toggle('custom-shape', !!shape);
      if (shape) {
        key.style.setProperty('--shape-mask', this.shapeMask(style.shapeId));
        key.style.setProperty('--shape-border', style.borderWidth ? this.shapeMask(style.shapeId, { width: cap.w, height: cap.h, thickness: style.borderWidth }) : 'none');
        key.style.setProperty('--shape-border-visible', style.borderWidth ? '1' : '0');
      } else { key.style.removeProperty('--shape-mask'); key.style.removeProperty('--shape-border'); }
      const variables: Record<string, string | number> = { '--idle-bg': rgba(style.background, style.backgroundOpacity), '--active-bg': style.accent, '--idle-ink': style.textColor, '--active-ink': style.activeTextColor, '--idle-border': rgba(style.borderColor, style.borderOpacity), '--active-border': style.activeBorderColor, '--border-width': `${style.borderWidth}px`, '--corner': `${style.radius}px`, '--font-family': fontStack(style.fontFamily), '--font-size': `${style.fontSize}px`, '--font-weight': style.fontWeight, '--letter-spacing': `${textSpacing(cap.label,style.letterSpacing)}px`, '--outline': `${style.textOutline}px`, '--text-shadow': style.textShadow ? `0 1px ${style.textShadow}px #000` : 'none', '--press-ms': `${timing.pressMs}ms`, '--release-ms': `${timing.releaseMs}ms`, '--travel': `${style.pressTravel}px`, '--glow': `${style.glowStrength}px` };
      for (const [name, value] of Object.entries(variables)) key.style.setProperty(name, `${value}`);
      this.fitLabel(key,cap,m);
      key.dataset.effect = style.effect;
      this.texture(key, cap, m, w, h);
    }
  }
  private fitLabel(key:HTMLElement,cap:Cap,m:OverlayModule){
    const style=resolvedStyle(m,cap.style);if(!style.autoFitText)return;
    const spacing=textSpacing(cap.label,style.letterSpacing),cacheKey=JSON.stringify([cap.label,style.fontFamily,style.fontWeight,style.fontSize,spacing]);
    let measured=this.textMetrics.get(cacheKey);
    if(!measured){
      this.measure.font=`${style.fontWeight} ${style.fontSize}px ${fontStack(style.fontFamily)}`;
      const metrics=this.measure.measureText(cap.label);
      measured={width:Math.max(metrics.width,metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight)+Math.max(0,graphemes(cap.label).length-1)*Math.max(0,spacing),height:Math.max(style.fontSize*1.6,metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent)};
      if(this.textMetrics.size>=256)this.textMetrics.clear();this.textMetrics.set(cacheKey,measured);
    }
    const {width,height}=measured;
    const size=Math.max(.5,style.fontSize*Math.min(1,Math.max(1,cap.w-8-style.borderWidth*2)/Math.max(1,width),Math.max(1,cap.h-8-style.borderWidth*2)/height));
    key.style.setProperty('--font-size',`${size}px`);
  }
  resize(){this.textMetrics.clear();if(!this.module)return;const keys=new Map([...this.context.element.querySelectorAll<HTMLElement>('.overlay-key')].map(key=>[key.dataset.capId,key]));for(const cap of capsFor(this.module).caps){const key=keys.get(cap.id);if(key)this.fitLabel(key,cap,this.module);}}
  private texture(key: HTMLElement, cap: Cap, m: OverlayModule, w: number, h: number) {
    const settings = m.image, asset = this.document.assets[settings.assetId], surface = key.querySelector('.key-surface')!;
    let art = surface.querySelector<HTMLElement>('.key-art');
    const enabled = settings.enabled && asset && cap.imageEnabled !== false;
    key.classList.toggle('has-art', !!enabled); key.dataset.imagePress = settings.press;
    key.style.setProperty('--image-opacity', `${settings.opacity}`); key.style.setProperty('--press-tint', `${settings.pressTint}`);
    if (!enabled) { art?.remove(); return; }
    if (!art) { art = document.createElement('div'); art.className = 'key-art'; surface.prepend(art); }
    let left = -cap.x, top = -cap.y, planeScale = 1;
    if (settings.groupId) {
      const unit = Math.min(m.w / w, m.h / h);
      const bounds = this.artworkRegion(m);
      left += (bounds.x - m.x) / unit; top += (bounds.y - m.y) / unit; planeScale = 1 / unit; w = bounds.w; h = bounds.h;
    }
    const url = this.assetUrl(settings.assetId), rect = imagePlacement(settings, asset, w, h);
    const transform = `rotate(${settings.rotation}deg) scale(${settings.flipX ? -1 : 1},${settings.flipY ? -1 : 1})`;
    art.style.mixBlendMode = settings.blend;
    art.style.setProperty('--image-brightness', `${settings.brightness}`); art.style.setProperty('--image-contrast', `${settings.contrast}`); art.style.setProperty('--image-saturation', `${settings.saturation}`);
    const signature = `${url}:${settings.fit === 'Tile'}`;
    if (art.dataset.source !== signature) {
      art.replaceChildren(); const plane = document.createElement('div'); plane.className = 'image-plane';
      const image = document.createElement('div'); image.className = 'image-content'; plane.append(image); art.append(plane);
      const tint = document.createElement('div'); tint.className = 'image-tint'; art.append(tint); art.dataset.source = signature;
    }
    const plane = art.querySelector<HTMLElement>('.image-plane')!, image = art.querySelector<HTMLElement>('.image-content')!, tint = art.querySelector<HTMLElement>('.image-tint')!;
    Object.assign(plane.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, transformOrigin: 'top left', transform: `scale(${planeScale})` });
    if (settings.fit === 'Tile') {
      const tile = tilePlane(w, h, settings.x, settings.y);
      Object.assign(image.style, { left: `${tile.left}px`, top: `${tile.top}px`, width: `${tile.size}px`, height: `${tile.size}px`, backgroundImage: `url("${url}")`, backgroundSize: `${rect.width}px ${rect.height}px`, backgroundRepeat: 'repeat', backgroundPosition: tile.position, transformOrigin: 'center', transform });
    } else {
      Object.assign(image.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, backgroundImage: `url("${url}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat', backgroundPosition: '0 0', transformOrigin: 'center', transform });
    }
    tint.style.background = rgba(settings.tint, settings.tintOpacity);
  }
 dispose(){this.textMetrics.clear();this.module=undefined;for(const control of this.controls)control.timeline.reset();this.controls=[];this.controlByElement=new WeakMap();this.context.element.replaceChildren();}
}
export const keyboardFactory:VisualFactory={create:context=>new CapRuntime(context)};
export const mouseFactory:VisualFactory={create:context=>new CapRuntime(context),wheelDuration:module=>module.wheelDuration};
