import {nativeErrorEnglish,nativeErrorRussian} from '../native-config';
import {polishEnglish,polishRussian} from '../polish-messages';
import {setupEnglish,setupRussian} from '../setup-messages';
import {connectionEnglish,connectionRussian} from '../connection-status-messages';
import {supportEnglish,supportRussian} from '../support/messages';
import {supportDefinitions} from '../support/schema';
import { builtinCatalog } from '../architecture/builtins';
import { animationSections } from '../architecture/animation';
import { LocalizationRegistry } from './registry';
import english from './catalogs/ui.en.json';
import russian from './catalogs/ui.ru.json';
import {settingConstraints} from '../architecture/registry';
import {overlayPacks} from './runtime';
import type {LocalePack} from './registry';

const errorsEn={'settings.disposed':'Settings are no longer available.','settings.nested-transaction':'Use one draft for the entire logical operation.','settings.async-transaction':'Decode asynchronous data before starting a settings transaction.','settings.unknown-setting':'Unknown setting: {{id}}','settings.invalid-setting':'Invalid value for {{id}}','settings.wrong-scope':'Use the explicit settings address and matching storage adapter.','settings.missing-profile':'Profile does not exist.','settings.missing-module':'Module does not exist.','settings.wrong-module':'Setting does not apply to this module.','settings.not-inheritable':'This setting does not support element overrides.','settings.wrong-element':'Keys belong to keyboard modules.','settings.missing-key':'Key does not exist.','settings.missing-button':'Mouse button does not exist.','settings.locked-module':'The module position is locked.','settings.invalid-preference':'Invalid application preference.','settings.reentrant-write':'Settings cannot be changed from a change notification.'};
const errorsRu={'settings.disposed':'Настройки больше недоступны.','settings.nested-transaction':'Используйте один черновик на всю логическую операцию.','settings.async-transaction':'Обработайте асинхронные данные перед транзакцией настроек.','settings.unknown-setting':'Неизвестная настройка: {{id}}','settings.invalid-setting':'Некорректное значение {{id}}','settings.wrong-scope':'Используйте явный адрес настройки и соответствующий адаптер хранилища.','settings.missing-profile':'Профиль не существует.','settings.missing-module':'Модуль не существует.','settings.wrong-module':'Настройка неприменима к этому модулю.','settings.not-inheritable':'Настройка не поддерживает переопределения элементов.','settings.wrong-element':'Клавиши принадлежат модулям клавиатуры.','settings.missing-key':'Клавиша не существует.','settings.missing-button':'Кнопка мыши не существует.','settings.locked-module':'Положение модуля заблокировано.','settings.invalid-preference':'Некорректная настройка приложения.','settings.reentrant-write':'Нельзя изменять настройки из уведомления об изменении.'};
const languageEn={title:'Languages & text',studio:'Studio language',overlay:'Overlay label language',help:'Studio language is independent of the overlay. Your own labels are never translated. Missing translations fall back to English.',import:'Import language package',export:'Export language template',remove:'Remove package',invalid:'Could not import this language package. Use a version 1 JSON package with a unique locale, valid namespaces and plain text, up to 1 MB.',saved:'Language package installed.',storage:'Language preferences could not be saved. Export the package to keep a copy.',unicode:'Labels support Unicode, automatic text direction and offline fallback fonts. Complex scripts use natural joining without letter spacing. Choose Unicode for the bundled font family.',exit:'Exit'};
const languageRu={title:'Языки и текст',studio:'Язык Studio',overlay:'Язык служебных подписей оверлея',help:'Язык Studio не связан с языком оверлея. Ваши собственные подписи не переводятся. Для отсутствующих переводов используется английский.',import:'Импорт языкового пакета',export:'Экспорт шаблона перевода',remove:'Удалить пакет',invalid:'Не удалось импортировать языковой пакет. Нужен JSON версии 1 с уникальным языком, корректными пространствами имён и обычным текстом, до 1 МБ.',saved:'Языковой пакет установлен.',storage:'Не удалось сохранить настройки языка. Экспортируйте пакет, чтобы оставить копию.',unicode:'Подписи поддерживают Unicode, автоматическое направление текста и встроенные шрифты без интернета. Для сложных письменностей сохраняется естественное соединение букв без межбуквенного интервала. Выберите Unicode для встроенного семейства шрифтов.',exit:'Выход'};
const ruByEnglish=new Map(Object.entries(english).filter(([key])=>key in russian).map(([key,value])=>[value,russian[key as keyof typeof russian]]));

export function createStudioLocalization(standardPacks:readonly LocalePack[] = []) {
  const registry=new LocalizationRegistry();
  const namespaces={
    polish:polishEnglish,setup:setupEnglish,connection:connectionEnglish,support:supportEnglish,ui:english,language:{...languageEn,loadError:'Could not load this language. Your previous language is still selected.',experimental:'Experimental',experimentalHelp:'Translations may contain inaccuracies. Missing translations use English.'},errors:{...errorsEn,...nativeErrorEnglish},
    settings:Object.fromEntries([...builtinCatalog.settings.all(),...supportDefinitions].flatMap(setting => [setting.label,setting.help,setting.disabledReason].filter(Boolean).map(text => [text!.key.split(':')[1],text!.fallback]))),
    modules:Object.fromEntries(builtinCatalog.modules.all().flatMap(module => [module.label,module.description].map(text => [text.key.split(':')[1],text.fallback]))),
    animation:{...Object.fromEntries(animationSections.flatMap(section=>[section.label,section.help].filter(text=>text?.fallback).map(text=>[text!.key.split(':')[1],text!.fallback]))),
      title:'Press & release',intro:'Movement, light and timing can be combined independently. Times are in milliseconds.',
      play:'Play animation',sampleHelp:'One press, then release. Preview only; your overlay receives no simulated input.',reducedMotion:'Reduced motion is on: movement is disabled.',
    },
    controls:{
      'number.instructions':'{{limits}}. ↑ / ↓: {{step}}; Shift: ×10. Enter to finish, Escape to cancel.',
      'number.invalid':'Use {{limits}}. Value not applied.', 'number.restored':'Use {{limits}}. Previous value restored.', 'number.integer':'whole numbers',
      'range.value':'{{label}} value', 'color.hex':'{{label}} hex', 'color.help':'Hex color, for example #BCAFFF',
      inherited:'Inherited', reset:'Reset ↶', 'reset.label':'Reset {{label}} to module', 'reset.default':'Reset {{label}} to default',
      unavailable:'This setting is unavailable in the current environment.', dependency:'Change the related setting to enable this control.',
      readonly:'This configuration is read-only. Export the original before opening it in a compatible version.',
      component:'This specialized editor is not available.', rejected:'This change could not be applied. The previous value is kept.',
    },
  };
  for(const setting of builtinCatalog.settings.all()){
    const constraints=settingConstraints(setting);
    for(const option of (constraints.enum??[]) as string[])if(option.trim())namespaces.settings[`${setting.id}.option.${Array.from(option,char=>char.codePointAt(0)!.toString(16)).join('-')}`]=option;
  }
  registry.register({version:1,locale:'en',namespaces});
  registry.register({version:1,locale:'en',namespaces:{language:{custom:'Custom translation',exportSelected:'Export selected translation',deleteTitle:'Delete custom translation?',deleteMessage:'Delete “{{name}}”? Built-in translations and other packages will be kept.',cancel:'Cancel',delete:'Delete',removeNamed:'Remove {{name}}',fallback:'English fallback',invalid:'Could not import this translation. Check the JSON schema version, metadata, size and placeholders.',storage:'Could not save language preferences. Your previous selection and packages are unchanged.'}}},{override:true});
  for(const pack of standardPacks)registry.register({...pack,namespaces:Object.fromEntries(Object.entries(pack.namespaces).filter(([namespace])=>namespace!=='overlay'))});
  const translated=Object.fromEntries(Object.entries(namespaces).filter(([namespace])=>!['ui','language'].includes(namespace)).map(([namespace,entries])=>[namespace,Object.fromEntries(Object.entries(entries).filter(([,value])=>ruByEnglish.has(value)).map(([key,value])=>[key,ruByEnglish.get(value)!]))]));
  registry.register({version:1,locale:'ru',namespaces:{...translated,polish:polishRussian,setup:setupRussian,connection:connectionRussian,support:supportRussian,ui:russian,language:{...languageRu,loadError:'Не удалось загрузить язык. Сохранён предыдущий выбор.',experimental:'Экспериментально',experimentalHelp:'Перевод может содержать неточности. Для отсутствующих переводов используется английский.'},errors:{...errorsRu,...nativeErrorRussian},controls:{...translated.controls,
    'number.instructions':'{{limits}}. ↑ / ↓: {{step}}; Shift: ×10. Enter — завершить, Escape — отменить.',
    'number.invalid':'Допустимо: {{limits}}. Значение не применено.','number.restored':'Допустимо: {{limits}}. Восстановлено предыдущее значение.','number.integer':'целые числа',
    'range.value':'Значение {{label}}','color.hex':'{{label}} HEX','color.help':'Цвет HEX, например #BCAFFF',inherited:'Унаследовано',reset:'Сбросить ↶','reset.label':'Сбросить {{label}} к модулю','reset.default':'Сбросить {{label}} к умолчанию',
    unavailable:'Настройка недоступна в текущем окружении.',dependency:'Измените связанную настройку для включения этого поля.',readonly:'Конфигурация только для чтения. Экспортируйте оригинал для совместимой версии.',component:'Специализированный редактор недоступен.',rejected:'Не удалось применить изменение. Предыдущее значение сохранено.',
  }}},{override:true});
  registry.register({version:1,locale:'ru',namespaces:{language:{custom:'Пользовательский перевод',exportSelected:'Экспорт выбранного перевода',deleteTitle:'Удалить пользовательский перевод?',deleteMessage:'Удалить «{{name}}»? Встроенные переводы и остальные пакеты сохранятся.',cancel:'Отмена',delete:'Удалить',removeNamed:'Удалить {{name}}',fallback:'Резервный английский',invalid:'Не удалось импортировать перевод. Проверьте версию схемы JSON, метаданные, размер и параметры подстановки.',storage:'Не удалось сохранить настройки языка. Прежний выбор и пакеты сохранены.'}}},{override:true});
  for(const pack of overlayPacks)registry.register(pack);
  return registry;
}
export const studioLocalization=createStudioLocalization();
export function languageTemplate():LocalePack{return {...studioLocalization.exportPack('en'),locale:'xx',name:'My language',direction:'ltr',translationVersion:'1.0'};}
