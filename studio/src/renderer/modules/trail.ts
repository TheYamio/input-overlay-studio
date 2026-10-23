import type { InputEvent } from '../../core/input';
import type { ModuleContext,ModuleFrame,ModuleUpdate,VisualFactory,VisualInstance } from './contracts';
import { Trail } from './trail-drawing';

class TrailRuntime implements VisualInstance {
 private trail?:Trail;private state!:ModuleUpdate;
 constructor(private context:ModuleContext){}
 update(state:ModuleUpdate){this.state=state;if(!this.trail){this.trail=new Trail(state.module,this.context.engine);this.context.element.append(this.trail.canvas);}this.trail.module=state.module;this.resize();}
 input(event:InputEvent,now:number){this.trail?.input(event,now);}
 frame({now,dirty}:ModuleFrame){
  const t=this.trail!;const movingCamera=Math.abs(t.x-t.cameraX)+Math.abs(t.y-t.cameraY)>.1&&t.module.position==='Follow / Recenter';
  const active=t.points.length>0||t.pending||t.clicks.length>0||movingCamera;if(active||dirty)t.draw(now,this.state.document);return {animate:active};
 }
 resize(){const trail=this.trail;if(!trail)return;const ratio=Math.max(1,Math.min(2,this.context.outputBounds().width/1920*window.devicePixelRatio)),w=Math.round(trail.module.w*ratio),h=Math.round(trail.module.h*ratio);if(trail.canvas.width!==w)trail.canvas.width=w;if(trail.canvas.height!==h)trail.canvas.height=h;}
 dispose(){if(this.trail){this.trail.points.clear();this.trail.clicks=[];this.trail.canvas.width=this.trail.canvas.height=0;this.trail.canvas.remove();this.trail=undefined;}}
}
export const trailFactory:VisualFactory={create:context=>new TrailRuntime(context)};
