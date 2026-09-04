import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RustMap, Builder, Waypoint } from './Map';
import { G } from './Physics';
import { pbr, flat } from './Materials';
import { fbm } from './Noise';
import { smoothstep } from './util';

/** 240 x 240 m refinery. Layout and decoration are deterministic on every client. */
export class SableMap extends RustMap {
  private static scenery=new Map<string,THREE.Group>();
  static async preload(){const loader=new GLTFLoader();await Promise.all(['namaqualand_rocks_01','old_military_crate','portable_generator','covered_car'].map(async id=>{const gltf=await loader.loadAsync('/models/scenery/'+id+'/'+id+'.gltf');this.scenery.set(id,gltf.scene);}));}
  override bounds = 120;
  private seed = 4815;
  private routePoints: THREE.Vector3[][] = [];
  private dust!: THREE.Points;
  private random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  override groundHeight(x: number, z: number) {
    const r = Math.max(Math.abs(x), Math.abs(z));
    return smoothstep(121, 177, r) * (19 + fbm(x * .022, z * .022, 4) * 24)
      + fbm(x * .27, z * .27, 2) * .035
      + (1-smoothstep(3,21,Math.hypot(x-36,z+84)))*6.5
      + (1-smoothstep(2,15,Math.hypot(x+44,z+81)))*4.8
      - (1-smoothstep(4,15,Math.hypot(x+12,z+96)))*3.4;
  }
  override build() {
    const M = this.makeMaterials(), B = new Builder(this.physics, this.group);
    M.asphalt = pbr('cracked_concrete', { tile: 3, color: 0x73716b, roughness: .94 });
    M.white = flat(0xd6c7a6, .92); M.yellow = flat(0xc79935, .8); M.light = flat(0xffffff, .2, .1, { emissive: 0xffdfac, emissiveIntensity: 2.5 });
    (M.sandstone as THREE.MeshStandardMaterial).color.set(0x8f8775);
    M.facade = pbr('concrete_wall_006', { tile: 2, color: 0xc2b89f });
    M.window = flat(0x1a323c, .14, .7);
    const ground = new THREE.PlaneGeometry(440, 440, 220, 220).rotateX(-Math.PI / 2);
    const ps = ground.attributes.position, uv = ground.attributes.uv;
    const colors = new Float32Array(ps.count * 3);
    for (let i = 0; i < ps.count; i++) {
      const x = ps.getX(i), z = ps.getZ(i); ps.setY(i, this.groundHeight(x, z)); uv.setXY(i, x, z);
      const c = (.86 + fbm(x * .048, z * .048, 3) * .2)*(1-smoothstep(123,175,Math.max(Math.abs(x),Math.abs(z)))*.24); colors.set([c, c * .96, c * .88], i * 3);
    }
    ground.setAttribute('color', new THREE.BufferAttribute(colors, 3)); ground.computeVertexNormals();
    (M.sand as THREE.MeshStandardMaterial).vertexColors = true;
    this.groundMesh = new THREE.Mesh(ground, M.sand); this.groundMesh.receiveShadow = true; this.group.add(this.groundMesh);
    this.physics.addStaticTrimesh(this.groundMesh, G.WORLD, { surface: 'sand' });
    const far = new THREE.Mesh(new THREE.PlaneGeometry(1600,1600).rotateX(-Math.PI/2),M.sandFar); far.position.y=-8; this.group.add(far);
    // Main service road and eastern freight road.
    B.box(M.asphalt, [224,.09,14], [0,.06,24], {tile:1, collide:false, shadow:false});
    B.box(M.asphalt, [13,.09,214], [57,.06,0], {tile:1, collide:false, shadow:false});
    for(let x=-108;x<112;x+=10) B.box(M.white,[4,.018,.14],[x,.117,24],{collide:false,shadow:false});
    for(let z=-102;z<104;z+=10) B.box(M.white,[.14,.018,4],[57,.117,z],{collide:false,shadow:false});
    // Refinery core: distillation columns, pipe racks, accessible tower, turbine house.
    this.buildTower(B,M);
    // The original hatch faces the outer rail. Step west onto the interior deck instead.
    this.ladders[0].center.x=2.7;this.ladders[0].halfW=.8;this.ladders[0].landing=new THREE.Vector3(1.05,10.5,.4);
    this.routePoints.push([new THREE.Vector3(8.3,.1,-3.2),new THREE.Vector3(5.7,1.9,-3.2),new THREE.Vector3(2.6,3.62,-3.2),new THREE.Vector3(.7,3.62,-2),new THREE.Vector3(-2.35,3.62,.6),new THREE.Vector3(-2.35,5.3,-1.6),new THREE.Vector3(-2.35,7.02,-3.9),new THREE.Vector3(.7,7.02,-2)]);
    for(const [x,z,r,h] of [[-23,-16,3.2,18],[-34,-18,2.5,24],[-44,-15,2.8,14],[-25,-36,3.7,12]]) {
      B.cyl(M.steel,r,h,[x,h/2,z],{tile:2,seg:28});
      B.cyl(M.steelDark,r+.22,.22,[x,.15,z],{seg:28});
      for(let y=3;y<h;y+=3.8) B.cyl(M.steelDark,r+.12,.16,[x,y,z],{seg:28,collide:false});
      B.cyl(M.corr,r,.9,[x,h+.4,z],{rTop:r*.4,seg:28});
      B.cyl(M.pipe,.4,h+3,[x+r+.6,(h+3)/2,z],{seg:12});
      // A flat inspection deck clears the conical cap; the ladder now reaches above its lip.
      const deck=h+1.02;
      B.box(M.grate,[r*2+.65,.18,r*2+.65],[x,deck-.09,z],{surface:'metal'});
      this.ladder(B,M,x-r-.6,z,.1,deck+.08,new THREE.Vector3(1,0,0));
      const ladder=this.ladders.at(-1)!;ladder.halfW=.82;ladder.landing=new THREE.Vector3(x-r+.25,deck+.12,z);
      for(const zz of[-1,1])B.box(M.steelDark,[r*2+.6,.7,.12],[x,deck+.35,z+zz*(r+.3)],{surface:'metal'});
      B.box(M.steelDark,[.12,.7,r*2+.6],[x+r+.3,deck+.35,z],{surface:'metal'});
    }
    for(const z of [-10,-8,-6]) B.cyl(M.pipe,.24,58,[-27,4.4,z],{rot:[0,0,Math.PI/2],seg:10,collide:false});
    for(let x=-52;x<0;x+=10){B.box(M.steelDark,[.3,4.6,.3],[x,2.3,-8]);B.box(M.steelDark,[.3,.25,7],[x,4.4,-8]);}
    this.garage(B,M,22,-15); this.garage(B,M,-29,9);
    this.sign('01 / REFINERY',-4,3.3,13,0,5);
    this.sign('SABLE ENERGY',-34,12.5,-14.99,0,6.5);
    // West tank farm, ringed with low cover. Walkable inspection deck.
    for(const [x,z] of [[-80,-53],[-97,-53],[-80,-76],[-97,-76]]) {
      B.cyl(M.concrete,7.2,.5,[x,.25,z],{seg:32});
      B.cyl(M.corr,6.5,8,[x,4.5,z],{tile:3,seg:40});
      B.cyl(M.steelDark,6.65,.25,[x,8.55,z],{seg:40});
      B.cyl(M.corr,6.5,.65,[x,8.95,z],{rTop:4.5,seg:40});
      for(const y of [1,7.8]) B.cyl(M.steelDark,6.55,.1,[x,y,z],{seg:40,collide:false});
      this.sign('S E  /  '+Math.abs(x+z),x,4,z+6.53,0,3.3);
    }
    for(let z=-93;z<-33;z+=8) this.sandbags(B,M,-65,z,90);
    this.pumpjack(B,M,-93,0,0); this.pumpjack(B,M,-91,17,15);
    // Freight terminal: lanes between containers, interiors, stacked landmarks.
    for(let row=0;row<4;row++) for(let col=0;col<4;col++) {
      const x=74+col*10,z=-75+row*13;
      this.container(B,M,[M.contBlue,M.contRust,M.contGreen,M.contRed][(row+col)%4],x,0,z,90,9,{openA:col%2===0,openB:col%2===0});
      if((row+col)%3===0) this.container(B,M,M.contYellow,x,2.67,z+1,90,9);
      this.sign('SE-'+row+col,x-1.225,1.7,z, -Math.PI/2,1.8);
    }
    // Gantry crane and rail siding.
    for(const x of [69,111]) for(const z of [-90,-78]) B.box(M.yellow,[1,16,1],[x,8,z]);
    for(const z of [-90,-78]) B.box(M.yellow,[44,1.5,1.5],[90,16,z]);
    B.box(M.steelDark,[3,2.4,5],[88,14.7,-84]);
    for(const z of [-85,-83]) B.cyl(M.cable,.045,11,[88,8,z],{seg:6,collide:false});
    B.box(M.yellow,[7,.3,3],[88,2.6,-84]);
    for(const x of [105,108]) B.box(M.steelDark,[.13,.12,190],[x,.12,9],{collide:false});
    for(let z=-80;z<105;z+=1.3) B.box(M.darkPlanks,[4,.1,.18],[106.5,.06,z],{collide:false,shadow:false});
    this.sign('02 / FREIGHT',62,3,-17,0,5);
    // Southern command compound: traversable rooms and rooftop routes.
    for(const [x,z] of [[-35,59],[-12,64],[14,58],[-35,90],[1,92]]) this.commandBuilding(B,M,x,z);
    B.box(M.concreteFloor,[54,.1,18],[-12,.08,79],{tile:1,collide:false});
    for(let x=-50;x<34;x+=8) if(x<-22||x>4)this.sandbags(B,M,x,43,0);
    this.sign('03 / COMMAND',-20,3,43,0,5.5);
    // Bridge spans the western maintenance lane, both sides have stairs.
    B.box(M.concreteFloor,[34,.28,5],[-75,5,48]);
    for(const x of [-89,-60])B.box(M.concrete,[1,5,4], [x,2.5,48]);
    for(const z of [45.5,50.5]) {
      B.box(M.steelDark,[34,.09,.09],[-75,6.1,z],{collide:false});
      for(let x=-92;x<-57;x+=2) B.box(M.steelDark,[.08,1.1,.08],[x,5.6,z],{collide:false});
    }
    this.stair(B,M,-102,48,0,90,5.14,10,3,'bridge-west');
    this.stair(B,M,-48,48,0,270,5.14,10,3,'bridge-east');
    this.routePoints.push([new THREE.Vector3(-102,0,48),new THREE.Vector3(-97,2.5,48),new THREE.Vector3(-92,5.14,48),new THREE.Vector3(-75,5.14,48),new THREE.Vector3(-58,5.14,48),new THREE.Vector3(-53,2.5,48),new THREE.Vector3(-48,0,48)]);
    // Motor pool and western extraction yard.
    this.hangar(B,M,-82,83,0); this.hangar(B,M,81,77,90);
    this.garage(B,M,74,39); this.watchtower(B,M,39,91,6);

    for(const [x,z] of [[-57,-100],[-28,-79],[12,-90],[38,-59],[-101,51],[39,58],[77,101]]) {
      this.container(B,M,M.contGreen,x,0,z,0,12,{openA:true,openB:true});
      for(let i=0;i<3;i++) B.box(M.plywood,[1.1,1.1,1.1],[x-6+i*1.2,.55,z+4],{rot:[0,i*.13,0]});
    }
    // Deliberate cover clusters in connecting lanes.
    for(const [x,z] of [[-47,-55],[-15,-54],[8,-33],[33,-36],[31,5],[-56,2],[-58,67],[36,71],[91,7],[-5,38],[22,39],[-109,-24]]) {
      this.sandbags(B,M,x,z,0); B.cyl(M.barrelRust,.36,1.1,[x+3,.55,z],{seg:16});
      B.box(M.plywood,[1.4,1.4,1.4],[x+4.5,.7,z-1],{rot:[0,.25,0]});
    }
    // Perimeter blast wall, distant mesas and foreground stones.
    for(const [x,z,w,d] of [[0,-120,242,1],[0,120,242,1],[-120,0,1,242],[120,0,1,242]]) B.box(M.concrete,[w,3.5,d],[x,1.75,z]);

    const pebbleGeo=new THREE.DodecahedronGeometry(1,0),pebbles=new THREE.InstancedMesh(pebbleGeo,M.rock3,550),dummy=new THREE.Object3D();
    for(let i=0;i<550;i++){const x=(this.random()-.5)*235,z=(this.random()-.5)*235,s=.05+this.random()*.2;dummy.position.set(x,this.groundHeight(x,z),z);dummy.scale.set(s,s*.45,s*.7);dummy.rotation.set(this.random()*6,this.random()*6,0);dummy.updateMatrix();pebbles.setMatrixAt(i,dummy.matrix);} pebbles.receiveShadow=true;this.group.add(pebbles);
    // Street lights, suspended cables and signage.
    for(let x=-104;x<=104;x+=26) {
      B.cyl(M.steelDark,.11,8,[x,4,34],{seg:8});B.box(M.steelDark,[3,.12,.12],[x+1.4,7.9,34],{collide:false});B.box(M.light,[.9,.1,.45],[x+2.7,7.8,34],{collide:false});
      if(x<100){ const pts=[new THREE.Vector3(x,7.6,34),new THREE.Vector3(x+13,6.7,34),new THREE.Vector3(x+26,7.6,34)];const c=new THREE.CatmullRomCurve3(pts);B.custom(M.cable,new THREE.TubeGeometry(c,10,.022,4,false),new THREE.Matrix4(),false); }
    }
    this.sign('SABLE REACH  /  RESTRICTED ZONE',0,2.7,119.45,Math.PI,14);
    this.environmentDetail(B,M);this.adventureRoutes(B,M);this.combatExpansion(B,M);this.scannedScenery();
    B.finish();
    this.physics.step(1/60);
    this.navigation();
    const sp=[[-52,103],[22,105],[96,101],[95,23],[45,-106],[8,-75],[-50,-98],[-108,-95],[-107,5],[-104,108],[-16,30],[35,-20],[-63,-30],[91,-13],[-60,80],[19,77],[-10,-28],[38,40]];
    for(const [x,z] of sp){const i=this.nearestWaypoint(new THREE.Vector3(x,0,z));if(i>=0)this.spawns.push({pos:this.waypoints[i].pos.clone().add(new THREE.Vector3(0,.1,0)),yaw:Math.atan2(x,z)});}
    this.makeDust(); return this.group;
  }
  /** Traversable upper routes, a quarry trail and vehicle jumps. */
  private adventureRoutes(B:Builder,M:Record<string,THREE.Material>){
    // An elevated pipeline walk joins two stair approaches and a two-floor relay station.
    const deckY=6.2;
    B.box(M.concreteFloor,[64,.3,4],[-18,deckY,-64]);
    for(const x of [-48,-32,-16,0,12]){
      B.box(M.concrete,[.6,deckY,3.5],[x,deckY/2,-64]);
      B.box(M.steelDark,[.8,.4,5],[x,deckY-.4,-64]);
    }
    for(const z of [-66,-62]){
      B.box(M.yellow,[64,.09,.09],[-18,deckY+1.1,z],{collide:false});
      for(let x=-50;x<15;x+=3) B.box(M.steelDark,[.08,1.1,.08],[x,deckY+.6,z],{collide:false});
    }
    this.stair(B,M,-61,-64,0,90,deckY+.15,11,3,'quarry-west');
    this.stair(B,M,25,-64,0,270,deckY+.15,11,3,'quarry-east');
    const path=[[-61,0],[-56,2.9],[-50,6.35],[-32,6.35],[-12,6.35],[14,6.35],[20,2.9],[25,0]];
    this.routePoints.push(path.map(([x,y])=>new THREE.Vector3(x,y,-64)));
    // Open workshop below, a fighting floor at 3 m, and a roof connected to the catwalk.
    for(const y of [0,3.1,6.2])B.box(M.concreteFloor,[16,.25,14],[0,y+.1,-51]);
    for(const x of [-8,8])for(const z of [-58,-44])B.box(M.steelDark,[.5,6.4,.5],[x,3.2,z]);
    for(const y of [1.55,4.65]){
      B.box(M.facade,[.3,3.1,14],[-8,y,-51]);
      for(const x of [-5.5,5.5])B.box(M.facade,[5,2.1,.3],[x,y-.5,-44]);
      B.box(M.steelDark,[5,.15,.6],[-5.5,y+.55,-43.8]);
    }
    this.stair(B,M,10,-39,0,180,3.325,7,2.5,'relay-mid');
    this.stair(B,M,10,-47,3.325,180,3,7,2.5,'relay-roof');
    B.box(M.concreteFloor,[4,.25,3],[9,3.2,-47]);
    B.box(M.concreteFloor,[4,.25,3],[9,6.2,-55]);
    B.box(M.concreteFloor,[4,.25,6],[0,6.2,-60]);
    for(const [x,z,y]of [[-4,-49,3.325],[3,-55,6.325],[4,-47,.225],[-5,-55,.225]]){
      B.box(M.plywood,[2,1.25,1],[x,y+.625,z]);
      B.box(M.steelDark,[2.1,.1,1.1],[x,y+1.3,z],{collide:false});
    }
    this.routePoints.push([new THREE.Vector3(10,0,-39),new THREE.Vector3(10,1.7,-42.5),new THREE.Vector3(10,3.325,-46),new THREE.Vector3(3,3.325,-49)]);
    this.routePoints.push([new THREE.Vector3(10,3.325,-47),new THREE.Vector3(10,4.8,-50.5),new THREE.Vector3(10,6.325,-54),new THREE.Vector3(0,6.325,-55),new THREE.Vector3(0,6.35,-64)]);
    this.sign('04 / RELAY STATION',0,5.55,-43.81,0,6);
    this.sign('QUARRY RUN  /  ATV TRAIL',-10,7.35,-61.91,0,8);
    // Ramp vertices are shared by visible geometry and physics, so tires track the surface.
    const ramp=(x:number,z:number,yaw:number,w:number,length:number,h:number)=>{
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute([-w/2,0,length/2,w/2,0,length/2,-w/2,h,-length/2,w/2,h,-length/2,-w/2,0,-length/2,w/2,0,-length/2],3));
      g.setIndex([0,2,1,1,2,3,2,4,3,3,4,5,0,4,2,1,3,5,0,1,5,0,5,4]);
      g.setAttribute('uv',new THREE.Float32BufferAttribute([0,length,w,length,0,0,w,0,0,h,w,h],2));g.computeVertexNormals();
      const m=new THREE.Matrix4().makeRotationY(yaw);m.setPosition(x,.04,z);B.custom(M.concreteFloor,g,m,'trimesh','concrete');g.dispose();
      for(const side of [-1,1]){
        const edge=new THREE.Vector3(side*(w/2+.2),h/2+.04,0).applyAxisAngle(new THREE.Vector3(0,1,0),yaw).add(new THREE.Vector3(x,0,z));
        B.box(M.yellow,[.22,.14,Math.hypot(length,h)],edge.toArray() as [number,number,number],{rot:[Math.atan(h/length),yaw,0],collide:false});
      }
    };
    ramp(-5,-111,-Math.PI/2,7,13,2.8);
    ramp(44,-30,Math.PI,6,12,3);
    ramp(91,102,Math.PI/2,7,14,3.4);
    // A wide drive-through overpass with two long drivable approaches.
    ramp(-110,61,0,6,16,3.5);ramp(-110,32,Math.PI,6,16,3.5);
    B.box(M.concreteFloor,[6,.3,13],[-110,3.39,46.5]);
    for(const z of [41,52])for(const x of [-112.6,-107.4])B.box(M.concrete,[.6,3.3,.8],[x,1.65,z]);
    // Freight overlook and low obstacles make a second upper combat lane.
    B.box(M.concreteFloor,[30,.28,4],[89,5.5,-23]);
    for(const x of [75,88,103]) B.box(M.steelDark,[.5,5.5,3],[x,2.75,-23]);
    this.stair(B,M,62,-23,0,90,5.64,12,3,'freight-overlook');
    this.routePoints.push([new THREE.Vector3(62,0,-23),new THREE.Vector3(68,2.82,-23),new THREE.Vector3(74,5.64,-23),new THREE.Vector3(89,5.64,-23),new THREE.Vector3(102,5.64,-23)]);
    for(const x of [78,88,98])B.box(M.contBlue,[2,1,1],[x,6.14,-24]);
    // Quarry retaining cuts, route bollards and stacked culvert shelter.
    for(let i=0;i<7;i++){
      const x=-31+i*5,z=-114,y=this.groundHeight(x,z);
      B.box(M.concrete,[4.6,1.3,1.2],[x,y+.65,z]);
    }
    for(const [x,z]of [[-32,-94],[8,-104],[18,-77],[42,-65],[-53,-96],[76,100],[102,95],[-106,64]]){
      const y=this.groundHeight(x,z);B.cyl(M.yellow,.13,1.2,[x,y+.6,z],{seg:8});
      B.cyl(M.light,.14,.14,[x,y+1.12,z],{seg:8,collide:false});
    }
    for(const x of [-22,-18]){B.cyl(M.concrete,1.8,9,[x,1.8,-72],{rot:[Math.PI/2,0,0],seg:20,open:true,collide:false});}
    // Functional culvert collision: side walls and ceiling leave a walkable interior.
    for(const x of [-22,-18]){for(const dx of [-1.55,1.55])B.box(M.concrete,[.25,2.5,9],[x+dx,1.25,-72]);B.box(M.concrete,[3.3,.4,9],[x,2.7,-72]);}
  }
  private scannedScenery(){
    const place=(id:string,x:number,z:number,height:number,yaw:number,part?:number,collide=false,y=0)=>{
      const asset=SableMap.scenery.get(id);if(!asset)return;
      const object=part===undefined?asset.clone():asset.children[part%asset.children.length].clone();
      if(id==='old_military_crate')for(const child of [...object.children])if(child.name.endsWith('_b'))object.remove(child);
      const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      const normalized=new THREE.Group();object.position.sub(new THREE.Vector3(center.x,box.min.y,center.z));normalized.add(object);
      normalized.scale.setScalar(height/size.y);normalized.rotation.y=yaw;normalized.position.set(x,y+this.groundHeight(x,z),z);
      normalized.traverse((o:any)=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const m=o.material;for(const key of ['map','normalMap','roughnessMap'])if(m[key])m[key].anisotropy=4;}});
      this.group.add(normalized);
      if(collide){const bounds=new THREE.Box3().setFromObject(normalized);this.physics.addStaticBox(bounds.getCenter(new THREE.Vector3()),bounds.getSize(new THREE.Vector3()),undefined,G.WORLD,{surface:id.includes('rocks')?'rock':'metal'});}
    };
    for(let i=0;i<26;i++){const a=i/26*Math.PI*2,r=151+this.random()*30;place('namaqualand_rocks_01',Math.sin(a)*r,Math.cos(a)*r,5+this.random()*12,this.random()*6.28,i%4);}
    for(const [x,z]of [[-109,-24],[-57,-58],[27,-81],[32,68],[-60,93],[98,58]])place('namaqualand_rocks_01',x,z,1.6+this.random(),this.random()*6.28,2,true);
    for(const [x,z]of [[-39,51],[-15,56],[11,50],[80,-20],[-21,10],[38,29],[-87,72],[72,-100]]){
      place('old_military_crate',x,z,.65,this.random()*.3,undefined,true,z===-100?1.2:0);
      place('old_military_crate',x+1.35,z+.25,.65,-.12,undefined,true,z===-100?1.2:0);
      place('old_military_crate',x+.3,z,.62,.14,undefined,false,(z===-100?1.2:0)+.65);
    }
    for(const [x,z,a]of [[34,23,0],[-62,24,20],[57,73,90],[84,56,10],[-82,98,0],[20,-52,70]])place('covered_car',x,z,1.9,a*Math.PI/180,undefined,true);
    for(const [x,z]of [[-30,53],[-7,69],[19,54],[-40,86],[82,36],[-76,73]])place('portable_generator',x,z,1.2,this.random()*6.28,undefined,true);
  }
  private environmentDetail(B:Builder,M:Record<string,THREE.Material>){
    // Steel lattice on the freight gantry, service ducts and generator enclosures.
    for(const z of [-90,-78])for(let x=70;x<110;x+=5){B.box(M.steelDark,[5.65,.14,.14],[x+2.5,15.3,z],{rot:[0,0,.38],collide:false});B.box(M.yellow,[5.65,.12,.12],[x+2.5,14.4,z],{rot:[0,0,-.38],collide:false});}
    for(const [x,z]of [[-14,6],[14,-28],[-54,-28],[39,9],[86,30],[-49,74]]){
      B.box(M.concreteFloor,[5,.24,3.5],[x,.12,z]);B.box(M.greenMetal,[3.4,1.8,1.7],[x,1.14,z]);
      for(let i=0;i<13;i++)B.box(M.steelDark,[.05,1.1,.06],[x-1.3+i*.2,1.2,z+.89],{collide:false});
      B.cyl(M.steelDark,.12,2.6,[x+1,2.7,z],{seg:8});B.box(M.yellow,[.6,.4,.035],[x-1,1.5,z+.91],{collide:false});
      B.cyl(M.pipe,.17,4,[x-2,1,z],{rot:[Math.PI/2,0,0],seg:10});
    }
    // Utility pipelines create silhouettes and deliberate close-quarter cover.
    for(const z of [-44,-46])B.cyl(M.pipe2,.65,37,[-29,1,z],{rot:[0,0,Math.PI/2],seg:16});
    for(let x=-46;x<-12;x+=7)B.box(M.concrete,[1,1.2,4],[x,.6,-45]);
    for(const [x,z]of [[-37,32],[-5,18],[48,-43],[71,11],[14,104],[-68,72]]){
      for(let row=0;row<3;row++)for(let i=0;i<5;i++)B.box(M.planks,[1.6,.08,.12],[x, .08+row*.15,z+i*.19],{collide:false});
      for(const dx of [-.6,.6])B.box(M.darkPlanks,[.13,.4,1.05],[x+dx,.2,z+.38]);
      for(const [dx,dz]of [[3,0],[3.7,.2],[3.2,.8]])B.cyl(M.barrelBlue,.3,.9,[x+dx,.45,z+dz],{seg:16});
    }
    // A walkable loading platform and its loading doors.
    B.box(M.concrete,[22,1.2,8],[76,.6,-101]);
    this.stair(B,M,62,-101,0,90,1.2,3,3,'loading');
    this.routePoints.push([new THREE.Vector3(62,0,-101),new THREE.Vector3(65,1.2,-101),new THREE.Vector3(76,1.2,-101)]);
    for(let x=68;x<=85;x+=4){B.box(M.yellow,[1.1,.06,.4],[x,1.23,-97.15],{collide:false});B.box(M.steelDark,[1.1,.06,.4],[x+1.1,1.23,-97.15],{collide:false});}
    for(const [x,z]of [[-35,59],[-12,64],[14,58],[-35,90],[1,92]]){
      B.box(M.pipe2,[15.8,.16,.16],[x,4.4,z-6.4],{collide:false});
      B.cyl(M.pipe,.075,4.4,[x-7.7,2.2,z-6.4],{seg:8,collide:false});
      B.box(M.corr,[2.5,.1,1.4],[x,2.9,z+6.65],{rot:[.12,0,0],collide:false});
      for(const dx of [-1.3,1.3])B.box(M.steelDark,[.06,1.3,.06],[x+dx,2.4,z+6.9],{rot:[-.6,0,0],collide:false});
      B.cyl(M.pipe,.3,.65,[x+4,5.05,z-3],{seg:14});
      B.cyl(M.steelDark,.55,.12,[x+4,5.4,z-3],{seg:14});
      this.sign('AUTHORIZED PERSONNEL',x,2.5,z-6.21,Math.PI,2.5);
    }
    // Dry grass: instanced geometry, no transparent overdraw or extra colliders.
    const vertices:number[]=[];for(let i=0;i<9;i++){const a=i*2.4,dx=Math.cos(a),dz=Math.sin(a),h=.2+(i%4)*.11;vertices.push(dx*.13,0,dz*.13,dx*.13+.023,0,dz*.13+.018,dx*.22,h,dz*.22);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
    const grass=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({color:0x7a7551,roughness:1,side:THREE.DoubleSide}),2400),dummy=new THREE.Object3D();
    for(let i=0;i<2400;i++){let x=(this.random()-.5)*232,z=(this.random()-.5)*232;if(Math.abs(z-24)<9||Math.abs(x-57)<8){x=-112+this.random()*7;}dummy.position.set(x,this.groundHeight(x,z),z);dummy.rotation.y=this.random()*6.28;dummy.scale.setScalar(.6+this.random()*1.4);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);}grass.receiveShadow=true;this.group.add(grass);
  }
  /** Cover is beside the roads; open windows and opposing roof approaches keep long lanes contestable. */
  private combatExpansion(B:Builder,M:Record<string,THREE.Material>){
    for(const [x,z,name]of [[-61,-22,'WEST OBSERVATION'],[23,3,'ROAD CONTROL'],[90,10,'FREIGHT SECURITY'],[-72,108,'EXTRACTION POST']] as [number,number,string][]){
      const y=this.groundHeight(x,z),h=3.7;
      B.box(M.concreteFloor,[12,.22,10],[x,y+.11,z]);B.box(M.concreteFloor,[12.4,.22,10.4],[x,y+h,z]);
      for(const side of[-1,1]){
        // Doors through north/south; real firing windows along east/west walls.
        for(const dx of[-3.75,3.75])B.box(M.facade,[4.5,h,.3],[x+dx,y+h/2,z+side*5]);
        B.box(M.facade,[3,1.1,.3],[x,y+h-.55,z+side*5]);
        B.box(M.facade,[.3,.85,10],[x+side*6,y+.425,z]);
        B.box(M.facade,[.3,1.35,10],[x+side*6,y+h-.675,z]);
        for(const dz of[-4.8,0,4.8])B.box(M.facade,[.3,1.5,.55],[x+side*6,y+1.6,z+dz]);
        B.box(M.concrete,[12,.7,.28],[x,y+h+.46,z+side*5]);
      }
      B.box(M.concrete,[.28,.7,10],[x-6,y+h+.46,z]);
      for(const dz of[-3.6,3.6])B.box(M.concrete,[.28,.7,2.8],[x+6,y+h+.46,z+dz]);
      this.stair(B,M,x+7.4,z+8,y,180,y+h+.11,8,2.3,'outpost-roof');
      B.box(M.concreteFloor,[4,.22,2.4],[x+6.8,y+h,z]);
      B.box(M.plywood,[2,1.1,1.2],[x-2,y+.77,z-2]);B.box(M.steelDark,[2,.7,1],[x+2,y+h+.46,z+1]);
      this.routePoints.push([new THREE.Vector3(x+7.4,y,z+8),new THREE.Vector3(x+7.4,y+h/2,z+4),new THREE.Vector3(x+7.4,y+h+.11,z),new THREE.Vector3(x+3,y+h+.11,z)]);
      this.sign(name,x,y+3.05,z+5.18,0,5);
    }
    // Staggered waist-high cover breaks exposed crossings without sealing either service road.
    for(const [x,z,yaw]of [[-48,15,0],[-25,15,0],[6,33,0],[31,15,0],[46,51,90],[67,3,90],[46,-12,90],[-76,-25,0],[-58,-43,90],[75,58,90],[-91,106,0],[3,-79,0]]){
      const y=this.groundHeight(x,z);B.box(M.concrete,[3.8,1.05,.85],[x,y+.525,z],{rot:[0,yaw*Math.PI/180,0]});
      B.box(M.yellow,[3.5,.12,.87],[x,y+.85,z],{rot:[0,yaw*Math.PI/180,0],collide:false});
    }
    this.sign('LONG SIGHTLINE / SERVICE ROAD',-42,2.8,18,0,5);
  }
  private commandBuilding(B:Builder,M:Record<string,THREE.Material>,x:number,z:number){
    const h=4.6,w=15,d=12;
    B.box(M.concreteFloor,[w,.2,d],[x,.1,z]); B.box(M.concreteFloor,[w+.5,.25,d+.5],[x,h,z]);
    for(const s of [-1,1]){
      B.box(M.facade,[.35,h,d],[x+s*w/2,h/2,z]);
      for(const side of [-1,1])B.box(M.facade,[(w-3)/2,h,.35],[x+side*(w+3)/4,h/2,z+s*d/2]);
      B.box(M.facade,[3,1.8,.35],[x,h-.9,z+s*d/2]);
      B.box(M.facade,[w,.5,.25],[x,h+.3,z+s*d/2]);
      for(const xx of [-4.5,4.5]){B.box(M.window,[2,1.25,.06],[x+xx,2.7,z+s*(d/2+.19)],{collide:false});B.box(M.steelDark,[2.3,.1,.3],[x+xx,2.0,z+s*(d/2+.25)],{collide:false});}
    }
    B.box(M.concreteBlock,[.25,3,4],[x+2,1.5,z+2]);
    B.box(M.darkPlanks,[2.6,.9,.8],[x-4,.55,z-3]); B.box(M.plywood,[1.1,1.2,1.1],[x+5,.6,z+3]);
    B.box(M.steelDark,[2.1,1,1.5],[x-3,h+.65,z],{tile:1});
    this.stair(B,M,x+w/2+2,z+11,0,180,h+.13,10,2.3,'roof');
    B.box(M.concreteFloor,[4,.24,2.5],[x+w/2+1,h,z+.8]);
    const path=[]; for(let i=0;i<=5;i++)path.push(new THREE.Vector3(x+w/2+2,i*(h+.13)/5,z+11-i*2));path.push(new THREE.Vector3(x+6,h+.13,z+1),new THREE.Vector3(x,h+.13,z+1));this.routePoints.push(path);
    this.sign('OPERATIONS',x,3.65,z+d/2+.2,0,4);
  }
  private sign(text:string,x:number,y:number,z:number,yaw:number,width:number){
    const c=document.createElement('canvas');c.width=1024;c.height=160;const g=c.getContext('2d')!;g.fillStyle='#24332e';g.fillRect(0,0,1024,160);g.strokeStyle='#b6ac85';g.lineWidth=5;g.strokeRect(8,8,1008,144);g.fillStyle='#e4d9b5';g.font='bold 62px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(text,512,83,955);
    const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;tx.anisotropy=4;const m=new THREE.Mesh(new THREE.PlaneGeometry(width,width*160/1024),new THREE.MeshStandardMaterial({map:tx,roughness:.8}));m.position.set(x,y,z);m.rotation.y=yaw;this.group.add(m);
  }
  private navigation(){
    const cells=new Map<string,number>(), down=new THREE.Vector3(0,-1,0), dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    for(let x=-116;x<=116;x+=4)for(let z=-116;z<=116;z+=4){
      const hit=this.physics.raycast(new THREE.Vector3(x,this.groundHeight(x,z)+1.8,z),down,3,G.WORLD);if(!hit||hit.point.y>this.groundHeight(x,z)+.55)continue;
      const p=hit.point.clone();let block=false;
      for(const [dx,dz]of dirs)if(this.physics.raycast(p.clone().add(new THREE.Vector3(0,1,0)),new THREE.Vector3(dx,0,dz),.5,G.WORLD)){block=true;break;}
      if(block)continue;const id=this.waypoints.length;this.waypoints.push({id,pos:p,links:[]});cells.set(x+','+z,id);
    }
    const link=(a:number,b:number)=>{if(a===b)return;const A=this.waypoints[a],B=this.waypoints[b];if(!A.links.includes(b))A.links.push(b);if(!B.links.includes(a))B.links.push(a);};
    for(const [key,id]of cells){const [x,z]=key.split(',').map(Number);for(const [dx,dz]of [[4,0],[0,4],[4,4],[-4,4]]){const other=cells.get((x+dx)+','+(z+dz));if(other===undefined)continue;const a=this.waypoints[id].pos.clone().add(new THREE.Vector3(0,.8,0)),b=this.waypoints[other].pos.clone().add(new THREE.Vector3(0,.8,0));if(this.physics.clearLine(a,b)&&this.physics.clearLine(a.clone().add(new THREE.Vector3(.32,0,.32)),b.clone().add(new THREE.Vector3(.32,0,.32))))link(id,other);}}
    // Explicit stair links keep roof and bridge routes accessible to AI.
    for(const route of this.routePoints){const ids=route.map(pos=>{const id=this.waypoints.length;this.waypoints.push({id,pos,links:[]});return id;});for(let i=1;i<ids.length;i++)link(ids[i-1],ids[i]);for(const id of [ids[0],ids.at(-1)!]){const p=this.waypoints[id].pos;for(const w of this.waypoints){if(w.id===id||w.pos.distanceTo(p)>6||Math.abs(w.pos.y-p.y)>.5)continue;if(this.physics.clearLine(p.clone().add(new THREE.Vector3(0,1,0)),w.pos.clone().add(new THREE.Vector3(0,1,0))))link(id,w.id);}}}
  }
  private makeDust(){const ps=new Float32Array(480*3);for(let i=0;i<480;i++)ps.set([(this.random()-.5)*240,1+this.random()*16,(this.random()-.5)*240],i*3);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(ps,3));this.dust=new THREE.Points(g,new THREE.PointsMaterial({color:0xd9c9a0,size:.055,transparent:true,opacity:.2,depthWrite:false}));this.group.add(this.dust);}
  update(dt:number){if(this.dust){this.dust.position.x=(this.dust.position.x+dt*.3)%12;this.dust.position.z=Math.sin(performance.now()*.00004)*2;}}
  sector(x:number,z:number){return x>62?'FREIGHT TERMINAL':z>42?(x< -55?'EXTRACTION YARD':'COMMAND COMPOUND'):x< -62?'TANK FARM':z< -55?'QUARRY / RIDGELINE':'REFINERY';}
}
