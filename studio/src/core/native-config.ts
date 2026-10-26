import {validBindHost} from './address.ts';
import {z} from 'zod';
import {boundedModuleJSON} from './module-envelope.ts';

// These exact field schemas drive the inspector and the generated Rust contract.
export const nativeConfigShape={
 capture_enabled:z.boolean(),host:z.string().min(1).max(253),port:z.number().int().min(1).max(65535),
 auth_token:z.string().min(1).max(256).regex(/^\S+$/u),
 key_whitelist:z.array(z.string().min(1).max(100).regex(/^[a-z0-9_]+$/)).max(512),
 raw_mouse_min_delta:z.number().int().min(0).max(10000),send_mouse_move:z.boolean(),
 cpu_affinity:z.array(z.number().int().min(0).max(63)).max(64),
 analog_keyboard:z.enum(['','auto','wooting','razer','nuphy','drunkdeer','keychron','madlions','bytech']),
 http_enabled:z.boolean(),http_port:z.number().int().min(1).max(65535),
 linux_evdev_keyboard_device:z.string().max(4096),linux_raw_mouse_device:z.string().max(4096),
};
// Unknown declarative fields survive reads/Apply, within the same bounded JSON
// limits used by Rust. They cannot weaken validation of the known fields.
export const nativeConfigStructure=z.object(nativeConfigShape).catchall(z.unknown());
export type NativeConfig=z.infer<typeof nativeConfigStructure>;
export const validInputDevice=(path:string)=>!path||!/[\x00-\x1f\x7f-\x9f]/.test(path)&&path.startsWith('/dev/input/')&&path.split('/').slice(3).every(part=>!!part&&part!=='.'&&part!=='..');
export const nativeConfigSchema=nativeConfigStructure.superRefine((value,ctx)=>{
 const add=(code:string,field?:string)=>ctx.addIssue({code:'custom',message:code,path:field?[field]:[],params:{nativeCode:code}});
 if(!boundedModuleJSON(value))add('native-invalid-config');
 if(!validBindHost(value.host))add('native-host','host');
 if(value.http_enabled&&value.http_port===value.port)add('native-ports','http_port');
 for(const field of ['key_whitelist','cpu_affinity'] as const)if(new Set<string|number>(value[field]).size!==value[field].length)add('native-invalid-field',field);
 for(const field of ['linux_evdev_keyboard_device','linux_raw_mouse_device'] as const)if(!validInputDevice(value[field]))add('native-invalid-field',field);
});
export const nativeErrorMessages={
 'native-invalid-config':'Capture settings contain invalid or unsupported data. Your current settings are unchanged.',
 'native-invalid-field':'Check the capture setting: {{field}}. Your current settings are unchanged.',
 'native-host':'Enter a valid IP address or hostname without a protocol, port or path.',
 'native-ports':'HTTP and WebSocket must use different ports while HTTP is enabled.',
 'native-storage':'Capture settings could not be saved. Check access to the application data folder and retry. Your current settings are unchanged.',
 'native-startup-invalid':'Saved capture settings could not be loaded. The original file is preserved and capture is disabled. Review the settings before applying them.',
 'native-startup-storage':'Capture settings could not be stored at startup. Capture is disabled. Check access to the application data folder and apply the settings again.',
};
export const nativeErrorEnglish=Object.fromEntries(Object.entries(nativeErrorMessages).map(([code,text])=>[`settings.${code}`,text]));
export const nativeErrorRussian={
 'settings.native-invalid-config':'Настройки захвата содержат некорректные или неподдерживаемые данные. Текущие настройки не изменены.',
 'settings.native-invalid-field':'Проверьте настройку захвата: {{field}}. Текущие настройки не изменены.',
 'settings.native-host':'Введите корректный IP-адрес или имя узла без протокола, порта и пути.',
 'settings.native-ports':'При включённом HTTP его порт должен отличаться от порта WebSocket.',
 'settings.native-storage':'Не удалось сохранить настройки захвата. Проверьте доступ к папке данных приложения и повторите попытку. Текущие настройки не изменены.',
 'settings.native-startup-invalid':'Не удалось загрузить настройки захвата. Исходный файл сохранён, захват выключен. Проверьте настройки перед применением.',
 'settings.native-startup-storage':'Не удалось сохранить настройки захвата при запуске. Захват выключен. Проверьте доступ к папке данных и примените настройки снова.',
};
