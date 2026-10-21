export const previewModes = ['Input', 'Idle', 'Pressed', 'Analog', 'Scroll up', 'Scroll down'] as const;
export type PreviewMode = typeof previewModes[number];
export interface PreviewState { mode: PreviewMode; depth: number }
export const inputPreview = (): PreviewState => ({ mode: 'Input', depth: .5 });
export function previewDepth(state: PreviewState, mouse: boolean, code: number): number | undefined {
  switch (state.mode) {
    case 'Input': return undefined;
    case 'Idle': return 0;
    case 'Pressed': return mouse && code >= 6 ? 0 : 1;
    case 'Analog': return mouse ? 0 : Math.max(0, Math.min(1, state.depth));
    case 'Scroll up': return mouse && code === 6 ? 1 : 0;
    case 'Scroll down': return mouse && code === 7 ? 1 : 0;
  }
}
