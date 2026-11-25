// Rendering pipeline: quality tiers, bloom + film grain on medium/high, plain render on low.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GrainShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.045 }, aberr: { value: 0.0006 }, fear: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform float aberr; uniform float fear; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){
      vec2 d = (vUv - 0.5); float a = aberr * (1.0 + fear * 3.0) * dot(d,d) * 4.0;
      vec3 c = vec3(texture2D(tDiffuse, vUv + d * a).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * a).b);
      float n = h(vUv * 1024.0) - 0.5; c += n * amount * (1.0 - clamp(dot(c, vec3(0.33)), 0.0, 1.0) * 0.6);
      float l = dot(c, vec3(0.299,0.587,0.114)); c = mix(c, vec3(l) * vec3(0.92,1.0,1.04), 0.12 + fear * 0.25);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class FX {
  constructor(G) { this.G = G; this.composer = null; this.bloom = null; this.grain = null; this.mode = null; }
  apply() {
    const G = this.G, r = G.renderer, q = G.settings.quality, dpr = window.devicePixelRatio || 1;
    const pr = q === 'low' ? Math.min(1, dpr) : q === 'medium' ? Math.min(1.5, dpr) : Math.min(2, dpr);
    r.setPixelRatio(pr); r.setSize(innerWidth, innerHeight, false);
    r.shadowMap.enabled = q !== 'low'; r.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95 * G.settings.brightness;
    G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix();
    G.ui.drawVignette(Math.round(innerWidth / 2), Math.round(innerHeight / 2), q === 'low' ? 0.9 : 1);
    if (q === 'low') { this.composer = null; this.mode = 'low'; return; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (!this.composer) {
      this.composer = new EffectComposer(r); this.composer.addPass(new RenderPass(G.scene, G.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.7, 0.82); this.composer.addPass(this.bloom);
      this.grain = new ShaderPass(GrainShader); this.composer.addPass(this.grain); this.composer.addPass(new OutputPass());
    }
    this.composer.setPixelRatio(pr); this.composer.setSize(innerWidth, innerHeight); this.bloom.strength = q === 'high' ? 0.6 : 0.4; this.bloom.resolution.set(size.x / (q === 'high' ? 2 : 4), size.y / (q === 'high' ? 2 : 4));
    this.mode = q;
  }
  render(t, fear) {
    const G = this.G;
    if (this.composer) { this.grain.uniforms.time.value = t % 100; this.grain.uniforms.fear.value = fear; this.composer.render(); }
    else G.renderer.render(G.scene, G.camera);
  }
}
