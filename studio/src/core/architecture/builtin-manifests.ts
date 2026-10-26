import {builtinCatalog} from './builtins';
import {moduleConfigurations} from '../module-format';
import {InputEngine} from '../input';
import {NativeSettings} from '../settings/native';
import {SettingsService} from '../settings/service';
import {updateSurface} from '../../renderer/modules/surface';
import type {CompiledModuleManifest} from './manifest';
import type {ModuleUI} from './module-ui';
import type {VisualFactory} from '../../renderer/modules/contracts';
const services={'core.capture':{adapter:NativeSettings},'core.input':{adapter:InputEngine},'core.profiles':{adapter:SettingsService},'core.renderer':{adapter:updateSurface}};
export function builtinManifests(runtime:Readonly<Record<string,VisualFactory>>,ui:Readonly<Record<string,ModuleUI>>={}):CompiledModuleManifest[]{
 return builtinCatalog.modules.all().map(definition=>({definition,settings:definition.settings.map(id=>builtinCatalog.settings.get(id)!),...(definition.kind==='service'?{service:services[definition.id as keyof typeof services]}:{configuration:moduleConfigurations.get(definition.id),runtime:runtime[definition.id],ui:ui[definition.id]})}));
}
