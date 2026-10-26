import {localEndpoint} from './address';
export interface HttpStatus { running: boolean; bind_error: string | null; host: string; port: number; overlay_available: boolean }

export function nativeOverlayBase(status: HttpStatus | null): string {
  if (!status) throw Error('Local HTTP server is disabled. Enable it in Native capture server and apply the settings.');
  if (!status.running) throw Error(status.bind_error === 'inuse'
    ? `HTTP port ${status.port} is already in use. Choose another HTTP port and apply the settings.`
    : status.bind_error === 'denied' ? 'Windows denied the HTTP server port. Choose another port and apply the settings.'
    : 'The HTTP server is not running. Check its host and port, then apply the settings.');
  if (!status.overlay_available) throw Error('The overlay page is missing from this build. Reinstall the complete application.');
  return localEndpoint('http',status.host,status.port,'/studio/overlay.html');
}
