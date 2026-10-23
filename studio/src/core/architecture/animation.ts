import type { DefinitionId, LocalizedText, SettingDefinition } from './contracts';

export const animationGroup='overlay.animation' as const;
export const animationSections:readonly {id:DefinitionId;label?:LocalizedText;help:LocalizedText;grid?:boolean}[] = Object.freeze([
  {id:'animation.preset',help:{key:'animation:preset.help',fallback:'Quick starting point. Fine-tune it below.'}},
  {id:'animation.movement',label:{key:'animation:movement.title',fallback:'MOVEMENT'},help:{key:'animation:movement.help',fallback:''}},
  {id:'animation.lighting',label:{key:'animation:lighting.title',fallback:'LIGHTING'},help:{key:'animation:lighting.help',fallback:'Uses Accent color and Pressed border color. Outline needs a border width above zero. Glow follows SVG contours; its quality follows Performance settings.'}},
  {id:'animation.timing',label:{key:'animation:timing.title',fallback:'TIMING · MS'},grid:true,help:{key:'animation:timing.help',fallback:'Delay waits before the visual change; duration controls its speed. Short taps remain visible. Input capture and sensitivity calculations stay immediate.'}},
]);

// Presentation metadata only; authoritative persisted schemas/defaults stay intact.
export function configureAnimationDefinitions(settings:SettingDefinition[]) {
  const orders=new Map<DefinitionId,number>();
  const configure=(id:DefinitionId,section:DefinitionId,patch:Partial<SettingDefinition>={},step?:number)=>{
    const index=settings.findIndex(setting=>setting.id===id),definition=settings[index];
    const order=orders.get(section)??0;orders.set(section,order+1);
    settings[index]={...definition,...patch,ui:{...definition.ui,group:animationGroup,section,order,...patch.ui,...(step!==undefined?{step}:{})}};
  };
  configure('overlay.surface.effect-preset','animation.preset',{label:{key:'settings:overlay.surface.effect-preset.label',fallback:'Press effect'},ui:{control:'custom',component:'animation.effect-preset',group:animationGroup}});
  configure('overlay.animation.motion','animation.movement');
  configure('overlay.animation.easing','animation.movement',{label:{key:'settings:overlay.animation.easing.label',fallback:'Animation easing'}});
  configure('overlay.animation.press-travel','animation.movement',{visibleWhen:[{setting:'overlay.animation.motion',test:'one-of',values:['Press','Lift','Bounce']}]},.5);
  configure('overlay.animation.motion-scale','animation.movement',{label:{key:'settings:overlay.animation.motion-scale.label',fallback:'Pressed scale'}},.01);
  configure('overlay.animation.lighting','animation.lighting');
  configure('overlay.animation.lighting-opacity','animation.lighting',{label:{key:'settings:overlay.animation.lighting-opacity.label',fallback:'Lighting intensity'},visibleWhen:[{setting:'overlay.animation.lighting',test:'not-equals',value:'Off'}]});
  configure('overlay.animation.glow-strength','animation.lighting',{visibleWhen:[{setting:'overlay.animation.lighting',test:'one-of',values:['Glow','Fill + glow']}]});
  configure('overlay.animation.secondary-color','animation.lighting');
  configure('overlay.animation.gradient-angle','animation.lighting',{},15);
  for(const id of ['press-duration','release-duration','press-delay','release-delay'] as const)configure(`overlay.animation.${id}`,'animation.timing');
}
