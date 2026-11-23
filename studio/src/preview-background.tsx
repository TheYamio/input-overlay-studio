import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Monitor } from 'lucide-react';
import { tr, trError } from './core/localization/messages';
import { rasterDimensions } from './core/raster';
import { useSettingsText } from './settings-localization';

const modes = ['transparent', 'light', 'dark', 'screenshot'] as const;
type BackgroundMode = typeof modes[number];
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const maxBytes = 24_000_000;
const maxPixels = 24_000_000;

export function usePreviewBackground() {
  const t = useSettingsText();
  const [mode, setMode] = useState<BackgroundMode>('transparent');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const currentUrl = useRef<string | undefined>(undefined);

  useEffect(() => () => {
    request.current++;
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
  }, []);

  function choose(next: BackgroundMode) {
    request.current++;
    setLoading(false);
    setError('');
    setMode(next);
  }

  async function load(file: File) {
    const id = ++request.current;
    setLoading(true);
    setError('');
    let url: string | undefined;
    try {
      if (file.size > maxBytes) throw Error(t('preview:imageSize'));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id !== request.current) return;
      const match = imageTypes.map(type => ({ type, size: rasterDimensions(`data:${type};base64`, bytes) })).find(match => match.size);
      const size = match?.size;
      if (!match || !size?.width || !size.height) throw Error(t('preview:imageFormat'));
      if (size.width * size.height > maxPixels) throw Error(tr('ui:s-56051436e181', 'Image exceeds 24 megapixels.'));
      url = URL.createObjectURL(file.slice(0, file.size, match.type));
      const decoded = new Image();
      decoded.src = url;
      await decoded.decode().catch(() => { throw Error(t('preview:imageFormat')); });
      if (id !== request.current) return;
      if (decoded.naturalWidth * decoded.naturalHeight > maxPixels) throw Error(tr('ui:s-56051436e181', 'Image exceeds 24 megapixels.'));
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = url;
      setImageUrl(url);
      setMode('screenshot');
      url = undefined;
    } catch (failure) {
      if (id === request.current) setError(trError(failure, t('preview:imageFormat')));
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (id === request.current) setLoading(false);
    }
  }

  return { mode, imageUrl, loading, error, choose, load };
}

export function PreviewBackgroundControl({ mode, imageUrl, loading, error, choose, load }: ReturnType<typeof usePreviewBackground>) {
  const t = useSettingsText();
  const input = useRef<HTMLInputElement>(null);
  return <div className="preview-background-control">
    <div className="preview-background-actions" aria-busy={loading}>
      <label className="preview-background-picker" title={t('preview:background')}>
        <Monitor size={14} aria-hidden="true"/>
        <select aria-label={t('preview:background')} value={mode} onChange={event => {
          const next = event.target.value as BackgroundMode;
          if (next === 'screenshot' && !imageUrl) input.current?.click();
          else choose(next);
        }}>
          {modes.map(option => <option key={option} value={option}>{option === 'transparent' ? tr('ui:s-aac7e89fcd0e', 'Transparent') : t(`preview:${option}`)}</option>)}
        </select>
      </label>
      {mode === 'screenshot' && <button className="icon-button" type="button" disabled={loading} aria-label={t('preview:replaceScreenshot')}
        title={t('preview:replaceScreenshot')} onClick={() => input.current?.click()}><ImagePlus size={15} aria-hidden="true"/></button>}
    </div>
    {error && <span className="preview-background-error" role="status">{error}</span>}
    <input ref={input} type="file" hidden accept={imageTypes.join(',')} aria-label={t('preview:chooseScreenshot')} onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void load(file);
    }}/>
  </div>;
}
