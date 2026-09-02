import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, SMAAEffect, ChromaticAberrationEffect, ToneMappingEffect, ToneMappingMode, BrightnessContrastEffect, HueSaturationEffect, Pass, SMAAPreset, EdgeDetectionMode } from 'postprocessing';
// @ts-ignore - n8ao ships without complete typings
import { N8AOPostPass } from 'n8ao';

/** Renders the first-person weapon layer on top of the scene with its own camera (no wall clipping, custom FOV). */
class ViewModelPass extends Pass {
  constructor(private sceneRef: THREE.Scene, private cam: THREE.PerspectiveCamera) { super('ViewModelPass'); this.needsSwap = false; }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null) {
    const bg = this.sceneRef.background; this.sceneRef.background = null;
    const fog = this.sceneRef.fog; this.sceneRef.fog = null;
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.clearDepth();
    renderer.render(this.sceneRef, this.cam);
    renderer.autoClear = ac; this.sceneRef.background = bg; this.sceneRef.fog = fog;
  }
}

export interface PostFX { composer: EffectComposer; bloom: BloomEffect; vignette: VignetteEffect; chroma: ChromaticAberrationEffect; n8ao: any; setSize: (w: number, h: number) => void; }

export function setupPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, weaponCam: THREE.PerspectiveCamera, opts: { ao: boolean }): PostFX {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  let n8ao: any = null;
  if (opts.ao) {
    n8ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
    n8ao.configuration.aoRadius = 1.6; n8ao.configuration.distanceFalloff = 1.2; n8ao.configuration.intensity = 2.2;
    n8ao.configuration.halfRes = true; n8ao.configuration.gammaCorrection = false; n8ao.configuration.color = new THREE.Color(0x0a0705);
    n8ao.setQualityMode('Medium');
    composer.addPass(n8ao);
  }
  composer.addPass(new ViewModelPass(scene, weaponCam));
  const bloom = new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.9, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.55 });
  const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0005, 0.0005), radialModulation: true, modulationOffset: 0.35 });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.5 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grade = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.06 });
  const sat = new HueSaturationEffect({ saturation: -0.06 });
  composer.addPass(new EffectPass(camera, bloom, chroma, tone, grade, sat, vignette));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR })));
  return { composer, bloom, vignette, chroma, n8ao, setSize: (w, h) => { composer.setSize(w, h); } };
}
