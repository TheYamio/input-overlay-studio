import { layoutKeys, yaws } from '../config';
import { resolvedStyle } from '../skins';
import { setModuleImage } from '../artwork-groups';
import { animationRead } from './animation';
import type { SettingsFieldAdapter } from './model';

export const documentAdapter:SettingsFieldAdapter={
 read(settings,definition,address){
  if(address.scope==='module' && (definition.binding.overrides || definition.id==='overlay.mouse.body-shape')){
   const module=settings.document.profiles.find(profile=>profile.id===address.profileId)?.modules.find(module=>module.id===address.moduleId);
   if(!module)throw Error('Module does not exist.');
   let override;
   if(address.element?.kind==='key'){const id=address.element.keyId;override=module.keys.find(key=>key.id===id)?.style;}
   else if(address.element)override=module.buttonStyles[address.element.button];
   const style=resolvedStyle(module,override),field=definition.binding.path.at(-1)!;
   if(definition.id==='overlay.mouse.body-shape')return module.mouseBodyShapeId??'';
   if(definition.ui.group==='overlay.animation')return animationRead(settings,definition,address);
   if(Object.hasOwn(style,field))return style[field as keyof typeof style];
  }
  return settings.read(definition.id,address);
 },
 constraints(settings,definition,address){
  if(address.scope!=='module'||address.element)return {};
  const module=settings.document.profiles.find(profile=>profile.id===address.profileId)?.modules.find(module=>module.id===address.moduleId);
  if(!module)return {};
  const limits:Record<string,number>={'overlay.instance.x':1920-module.w,'overlay.instance.y':1080-module.h,'overlay.instance.width':1920-module.x,'overlay.instance.height':1080-module.y};const maximum=limits[definition.id];
  return maximum===undefined?{}:{maximum};
 },
 write(settings,definition,address,value){
  if(!definition.schema.safeParse(value).success)return false;
  const id=definition.id;
  if(address.scope==='module' && !address.element){
   const profile=settings.document.profiles.find(profile=>profile.id===address.profileId)!,module=profile.modules.find(module=>module.id===address.moduleId)!;
   if(id==='overlay.keyboard.layout')return settings.setMany([{id,address,value},...(value==='Custom'?[]:[{id:'overlay.keyboard.keys' as const,address,value:layoutKeys(value as Parameters<typeof layoutKeys>[0])}])]);
   if(id==='overlay.mouse.mode'){
    const w=value==='Mouse Diagram'?220:300,h=value==='Mouse Diagram'?300:110;
    return settings.setMany([{id,address,value},...(!module.locked?[{id:'overlay.instance.width' as const,address,value:w},{id:'overlay.instance.height' as const,address,value:h},{id:'overlay.instance.x' as const,address,value:Math.min(module.x,1920-w)},{id:'overlay.instance.y' as const,address,value:Math.min(module.y,1080-h)}]:[])]);
   }
   if(definition.binding.path[0]==='image'){
    return settings.transaction(doc=>{const target=doc.profiles.find(profile=>profile.id===address.profileId)!;const member=target.modules.find(module=>module.id===address.moduleId)!;setModuleImage(target.modules,member.id,{...member.image,[definition.binding.path[1]]:value});},{source:'settings',scopes:['module']});
   }
  }
  if(address.scope==='game-profile'){
   const profile=settings.document.gameProfiles.find(profile=>profile.id===address.profileId)!;
   if(id==='profiles.game.game')return settings.setMany([{id,address,value},{id:'profiles.game.yaw',address,value:yaws[String(value)]||profile.yaw},{id:'profiles.game.scale',address,value:value==='KovaaK’s'?'Unknown':profile.scale}]);
   if(id==='profiles.game.yaw'&&profile.game==='KovaaK’s')return settings.setMany([{id,address,value},{id:'profiles.game.scale',address,value:'Custom yaw'}],{preserveGesture:true});
  }
  return settings.set(id,address,value);
 },
 reset(settings,definition,address){
  if(address.scope==='module'&&!address.element&&definition.binding.path[0]==='image'){
   const module=settings.document.profiles.find(profile=>profile.id===address.profileId)?.modules.find(module=>module.id===address.moduleId);
   return !!module&&documentAdapter.write!(settings,definition,address,definition.defaultValue({moduleType:module.type}));
  }
  return settings.reset(definition.id,address);
 },
};
