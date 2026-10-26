import type {DefinitionId,LocalizedText} from './contracts';
export const settingGuidance:Partial<Record<DefinitionId,LocalizedText>>=Object.fromEntries(Object.entries({
 'profiles.game.dpi':'Match the DPI set on your mouse, for example 1600. This affects distance calculations; it does not change your mouse settings.',
 'profiles.game.sensitivity':'Copy the sensitivity value from your game, for example 1.3. Linked overlays share this game setting.',
 'profiles.game.yaw':'Degrees turned per mouse count at sensitivity 1. Use your game’s yaw value; changing it changes cm/360.',
 'profiles.game.manual-cm':'Your measured mouse travel for one full turn. For example, 40 means 40 cm per 360°. Used by the Manual scale.',
 'overlay.animation.press-delay':'Wait before showing a press. 0 ms responds immediately; 80 ms waits 0.08 seconds. Only the visual is delayed.',
 'overlay.animation.release-delay':'Wait before showing a release. For example, 100 ms keeps the pressed visual for 0.1 seconds longer.',
 'overlay.trail.scale':'Visual movement multiplier. For example, 2 draws twice the movement of 1. It does not change physical distance totals.',
 'overlay.trail-appearance.speed-range':'Speed needed to reach the fast color. A larger value needs faster movement; the slow and fast colors define the gradient.',
 'overlay.artwork.opacity':'Image visibility: 0% is invisible, 100% is fully visible. The key surface and module opacity also affect the final result.',
 'overlay.artwork.blend':'Normal keeps the image colors. Multiply darkens against the key surface; Screen lightens it. Try opacity 50% to keep labels clear.',
 'render.performance.fps':'Maximum animation rate. 30 uses fewer frames than 60; Auto follows the display up to 120 FPS. Input capture is independent.',
}).map(([id,fallback])=>[id,{key:`settings:${id}.help`,fallback}]));
