import {tr} from './core/localization/messages.ts';
import type { KeyboardEvent, PointerEvent } from 'react';
import { resizeDirections, type ResizeDirection } from './core/transform';

const directionNames = { nw: 'top left', n: 'top', ne: 'top right', e: 'right', se: 'bottom right', s: 'bottom', sw: 'bottom left', w: 'left' };
export function TransformHandles({ name, selected = true, keyHandle = false, begin, move, finish, cancel, keyboard }: {
  name: string; selected?: boolean; keyHandle?: boolean;
  begin: (event: PointerEvent<HTMLButtonElement>, direction: ResizeDirection) => void;
  move: (event: PointerEvent<HTMLButtonElement>) => void; finish: () => void; cancel: () => void;
  keyboard: (event: KeyboardEvent<HTMLButtonElement>, direction: ResizeDirection) => void;
}) {
  return <>{resizeDirections.map(direction => <button key={direction} type="button" tabIndex={selected ? 0 : -1} aria-hidden={!selected} aria-label={tr('ui:s-efceba6ba14d',"Resize {{p0}}{{p1}}",{p0:String(name),p1:String(direction === 'se' ? '' : ` ${directionNames[direction]}`)})} title={tr('ui:s-9754f00b7edc',"Resize {{p0}} · Arrow keys: 1 · Shift: 10",{p0:String(directionNames[direction])})} data-resize={direction} className={`transform-handle transform-${direction} ${direction.length === 2 ? 'transform-corner' : 'transform-edge'}${direction === 'se' ? keyHandle ? ' key-resize-handle' : ' resize-handle' : ''}`} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => begin(e, direction)} onPointerMove={e => { e.stopPropagation(); move(e); }} onPointerUp={e => { e.stopPropagation(); finish(); }} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={e => keyboard(e, direction)}/>)}</>;
}
