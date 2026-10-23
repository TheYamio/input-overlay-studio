import {trText} from './core/localization/messages';
import { useContext, type ReactNode } from 'react';
import type { DefinitionId } from './core/architecture/contracts';
import { builtinCatalog } from './core/architecture/builtins';
import { documentAdapter } from './core/settings-ui/document';
import { SettingsField } from './settings-renderer';
import { SettingsScope } from './settings-scope';
import { ExternalField, ExternalSettingsScope } from './external-settings';

export function RegisteredField({id,label,fallback}:{id:DefinitionId;label:string;fallback:ReactNode}) {
 const scope=useContext(SettingsScope), external=useContext(ExternalSettingsScope);
 if(external && builtinCatalog.settings.get(id)?.binding.store==='native')return <ExternalField id={id} label={label}/>;
 if(!scope)return fallback;
 const definition=builtinCatalog.settings.get(id)!;
 const base=scope.address;
 const address='profileId' in base && definition.binding.scope!=='module' ? {scope:definition.binding.scope as 'game-profile'|'overlay-profile',profileId:base.profileId}:base;
 const prefix=base.scope==='module'&&base.element ? label.startsWith(trText('Key '))?trText('Key '):label.startsWith(trText('Button '))?trText('Button '):'' : '';
 return <SettingsField settings={scope.settings} id={id} address={address} adapter={documentAdapter} labelPrefix={prefix} caption={{key:`settings:${id}.caption`,fallback:label.slice(prefix.length)}}/>;
}
