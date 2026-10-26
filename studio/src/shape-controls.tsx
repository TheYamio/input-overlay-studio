import {tr,trText} from './core/localization/messages.ts';
import { registerSettingsView } from './settings-views';
import { createContext, useContext, useRef, useState } from 'react';
import { readSvgShape } from './core/svg-import';
import { shapeUrl, type VectorShape } from './core/shapes';
import { Inheritance } from './style-tools';
import type { DefinitionId } from './core/architecture/contracts';
import { SettingsScope } from './settings-scope';
import { documentAdapter } from './core/settings-ui/document';
import { SettingsComponentRegistry } from './settings-components';
import { SettingsField } from './settings-renderer';

export const ShapeLibrary = createContext<{
  shapes: Record<string, VectorShape>;
  add?: (shape: VectorShape, apply: (id: string) => void, input: HTMLInputElement) => void;
  removeUnused?: () => void;
}>({ shapes: {} });
function ShapeLibraryControl({ value, change, prefix,inheritance=true }: { value: string; change: (id: string) => void; prefix: string;inheritance?:boolean }) {
  const library = useContext(ShapeLibrary), input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const shape = library.shapes[value];
  return <div className="shape-control">
    <label className="field"><span>{trText(prefix)}{tr('ui:s-e0e492707f85',"Shape")}</span><select aria-label={tr('ui:s-56457d3d0787',"{{p0}}Shape",{p0:trText(prefix)})} value={value} onChange={e => change(e.target.value)}><option value="">{prefix === 'Mouse body ' ? tr('ui:s-393a26b6ef1e',"Standard mouse") : tr('ui:s-c93421a7b10b',"Rounded rectangle")}</option>{Object.entries(library.shapes).map(([id, shape]) => <option key={id} value={id}>{shape.name}</option>)}</select>{inheritance&&<Inheritance label={tr('ui:s-56457d3d0787',"{{p0}}Shape",{p0:trText(prefix)})}/>}</label>
    {shape && <div className="shape-preview" aria-label={tr('ui:s-5233f4fb972a',"{{p0}}Shape preview",{p0:trText(prefix)})}><span style={{ maskImage: shapeUrl(shape), WebkitMaskImage: shapeUrl(shape) }}/><small>{shape.name}{tr('ui:s-4e7345db6345',"· vector")}</small></div>}
    <label className="image-upload"><span>{busy ? tr('ui:s-aed46915ddc5',"Importing shape…") : tr('ui:s-03c901c7b573',"Upload SVG shape")}</span><input ref={input} type="file" accept=".svg,image/svg+xml" aria-label={tr('ui:s-cc569413967a',"{{p0}}Upload SVG shape",{p0:trText(prefix)})} disabled={busy || !library.add} onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      setBusy(true); setMessage('');
      try { const shape = await readSvgShape(file); library.add!(shape, change, input.current!); setMessage(`Imported ${shape.name}. Shape and holes scale with the button.`); }
      catch (error) { setMessage((error as Error).message); }
      finally { setBusy(false); }
    }}/></label>
    <p className="hint">{tr('ui:s-26d3946373e9',"SVG paths and basic shapes, up to 128 KB. Convert text and effects to paths. The silhouette clips the background, artwork and press fill. SVG corners are defined by the file; corner radius applies to rounded rectangles.")}</p>
    {library.removeUnused && <button className="text-button" onClick={library.removeUnused}>{tr('ui:s-9d58958f0602',"Remove unused shapes")}</button>}
    {message && <p className="hint" role="status">{trText(message)}</p>}
  </div>;
}

const ShapePrefix=createContext(''),shapeComponents=new SettingsComponentRegistry();
shapeComponents.register('editor.shape-library',({value,change})=><ShapeLibraryControl value={value as string} change={change} prefix={useContext(ShapePrefix)} inheritance={false}/>);
function BoundShapeControl({settingId,...props}:Parameters<typeof ShapeLibraryControl>[0]&{settingId?:DefinitionId}){
 const scope=useContext(SettingsScope);
 return scope&&settingId?<ShapePrefix.Provider value={props.prefix}><SettingsField settings={scope.settings} address={scope.address} id={settingId} adapter={documentAdapter} specialized={shapeComponents} labelPrefix={props.prefix} caption={{key:`settings:${settingId}.caption`,fallback:'Shape'}}/></ShapePrefix.Provider>:<ShapeLibraryControl {...props}/>;
}
export const ShapeControl=registerSettingsView('editor.shape-library',BoundShapeControl);
