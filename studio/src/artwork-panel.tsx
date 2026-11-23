import { activeProfile } from './core/config';
import { tr } from './core/localization/messages';
import type { ModuleEditorProps } from './module-editor-contracts';
import { registerSettingsView } from './settings-views';

function ArtworkPanelView({ document, module, linkImage, openArtwork }: ModuleEditorProps) {
  const { image } = module, asset = document.assets[image.assetId];
  const peers = activeProfile(document).modules.filter(other => other.id !== module.id && (other.type === 'keyboard' || other.type === 'mouse'));
  return <section className="property-section artwork-panel">
    <h4>{tr('ui:s-ea63c9d49b5f', 'Keycap artwork')}</h4>
    {asset && <div className="image-asset">
      <img src={asset.data} alt={tr('ui:s-ea63c9d49b5f', 'Keycap artwork')}/>
      <div><bdi>{asset.name}</bdi><span>{asset.width} × {asset.height}</span></div>
    </div>}
    <button className="secondary" aria-haspopup="dialog" onClick={openArtwork}>{tr('ui:s-d28cc0a79136', 'Position & scale image')}</button>
    {peers.length > 0 && <details className="visual-details artwork-group">
      <summary>{tr('ui:s-0fb9aecf9d6d', 'Shared artwork across modules')}</summary>
      <p className="hint">{tr('ui:s-a1e5288b1ba9', 'Members share the image, placement and adjustments. Coordinates span their painted surfaces on the canvas, including hidden members.')}</p>
      {peers.map(other => <label key={other.id} className="visual-check">
        <input type="checkbox" aria-label={tr('ui:s-954686adeb21', 'Share artwork with {{p0}}', { p0: other.name })}
          checked={!!image.groupId && other.image.groupId === image.groupId} onChange={event => linkImage(other.id, event.target.checked)}/>
        <bdi>{other.name}</bdi>
      </label>)}
      <p className="hint">{tr('ui:s-8b7c5e4a282a', "Unchecking keeps that module's current image settings as an independent copy.")}</p>
    </details>}
  </section>;
}

export const ArtworkPanel = registerSettingsView('editor.image-library', ArtworkPanelView);
