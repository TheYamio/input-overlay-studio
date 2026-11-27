import type {InputStatistics} from '../../core/input-statistics';
import {numberLocale} from '../../core/unicode';
import {overlayText} from '../../core/localization/runtime';
import type {ModuleContext, ModuleFrame, ModuleUpdate, VisualFactory, VisualInstance} from './contracts';
import {fitTextModule} from './surface';

class StatisticsMetric implements VisualInstance {
  private state!: ModuleUpdate;
  private previous?: InputStatistics;
  private format = new Intl.NumberFormat('en', {maximumFractionDigits: 2});
  private caption = document.createElement('span');
  private number = document.createElement('strong');
  private detail = document.createElement('span');

  constructor(private context: ModuleContext, private flicks: boolean) {
    this.caption.className = 'metric-caption';
    this.caption.dir = 'auto';
    this.detail.className = 'metric-caption statistics-detail';
    this.detail.dir = 'auto';
    const content = document.createElement('div');
    content.className = 'module-text-content metric-content statistics-content';
    content.append(this.caption, this.number);
    if (flicks) content.append(this.detail);
    context.element.classList.add('metric');
    context.element.replaceChildren(content);
  }

  private text(key: string, fallback: string) {
    const {document, profile} = this.state;
    return overlayText(document.languagePacks, profile.locale, key, fallback, profile.localePackageId);
  }

  update(state: ModuleUpdate) {
    if (!this.state || this.state.profile.locale !== state.profile.locale) {
      this.format = new Intl.NumberFormat(numberLocale(state.profile.locale), {maximumFractionDigits: 2});
    }
    this.state = state;
    const {module} = state;
    this.caption.textContent = module.caption || (this.flicks ? this.text('flicks','Flicks')
      : module.counterMode === 'Custom' ? this.text('counter','Counter') : module.counterMode);
    this.render();
    this.resize();
  }

  frame({dirty}: ModuleFrame) {
    if (dirty || this.previous !== this.context.engine.statistics) {
      if (this.render()) this.resize();
    }
  }

  private render() {
    const {profile, module} = this.state;
    const incoming = this.context.engine.statistics;
    this.previous = incoming;
    const statistics = incoming?.profileId === profile.id ? incoming : undefined;
    const metrics = this.flicks ? statistics?.flicks.get(module.id) : undefined;
    const value = this.flicks ? metrics?.count : statistics?.counters.get(module.id);
    const next = value === undefined ? '—' : this.format.format(value);
    const unit = module.flickUnit;
    const detail = metrics
      ? `${this.text('peakSpeed','Peak')} ${this.format.format(metrics.peak_mps)} ${this.text('mps','m/s')} · ${this.text('path','Path')} ${this.format.format(metrics.distance_cm / (unit === 'm' ? 100 : 1))} ${this.text(unit,unit)}`
      : '';
    const changed = this.number.textContent !== next || this.detail.textContent !== detail;
    if (this.number.textContent !== next) this.number.textContent = next;
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    return changed;
  }

  resize() { fitTextModule(this.context.element, this.state.module); }
  dispose() { this.context.element.replaceChildren(); }
}

export const counterFactory: VisualFactory = {create: context => new StatisticsMetric(context, false)};
export const flicksFactory: VisualFactory = {create: context => new StatisticsMetric(context, true)};
