import { FolderOpen, Globe2, Keyboard, Radio, Zap } from 'lucide-react';
import { tr, trText } from './core/localization/messages';
import { useSettingsText } from './settings-localization';

export function SettingsIndex() {
  const t = useSettingsText();
  const items = [
    { id: 'settings-language', icon: Globe2, label: t('language:title') },
    { id: 'settings-connection', icon: Radio, label: tr('ui:s-4b15c3f79252', 'INPUT & CONNECTION') },
    { id: 'keyboard-shortcuts', icon: Keyboard, label: tr('ui:s-e9bef0b0f3c2', 'Keyboard shortcuts') },
    { id: 'settings-performance', icon: Zap, label: tr('ui:s-08a796052014', 'Rendering performance') },
    { id: 'settings-config', icon: FolderOpen, label: tr('ui:s-235fa4283ba8', 'Your configuration') },
  ];

  return <nav className="settings-index" aria-label={trText('Settings')}>
    {items.map(({ id, icon: Icon, label }) => <a key={id} href={`#${id}`} onClick={event => {
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ block: 'start' });
      target.focus({ preventScroll: true });
    }}><Icon size={17} aria-hidden="true"/>{label}</a>)}
  </nav>;
}
