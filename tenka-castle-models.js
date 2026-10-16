/* Detailed, deterministic Sengoku castle structures for the live 3D battlefield.
 * Architecture follows the castle's terrain and earth/stone profile. These are
 * game-scale creative reconstructions, not measured archaeological models.
 * No collision, route, structure state, or combat rules are changed here.
 */
(function (root) {
  "use strict";

  function createStructure(THREE, options = {}) {
    if (!THREE?.Group || !THREE.Mesh || !THREE.BoxGeometry || !THREE.BufferGeometry || !THREE.Float32BufferAttribute || !THREE.CylinderGeometry || !THREE.Vector3) return null;
    const structure = options.structure || {};
    const battle = options.battle || {};
    const layout = options.layout || battle.layout || {};
    const source = options.materials || {};
    const materials = {
      wood: source.wood, darkWood: source.darkWood || source.wood,
      stone: source.stone || source.earth || source.wood,
      earth: source.earth || source.stone || source.wood,
      plaster: source.plaster || source.wood,
      roof: source.roof || source.darkWood || source.wood,
      iron: source.iron || source.darkWood || source.wood,
    };
    if (Object.values(materials).some((material) => !material)) return null;
    const group = new THREE.Group();
    const kind = structure.kind || structure.type || "hall";
    const width = Math.max(0.12, Number(structure.w || structure.width) || 2.5);
    const depth = Math.max(0.12, Number(structure.d || structure.depth) || 2.5);
    const height = Math.max(0.4, Number(structure.height || structure.h) || 2.8);
    const profile = battle.profile || layout.profile || battle.targetCastle?.profile || {};
    const terrain = battle.terrain || layout.biome || battle.targetCastle?.terrain || "plain";
    const mountain = terrain === "mountain" || Number(profile.elevation) >= 180;
    const stoneFort = profile.wall === "stone";
    const mixedFort = profile.wall === "mixed";
    const heightAt = typeof options.heightAt === "function" ? options.heightAt : () => 0;
    const centerHeight = Number(heightAt(structure.x || 0, structure.z || 0)) || 0;
    const baileys = layout.baileys || [];
    const mainBailey = baileys.slice().sort((left,right) => {
      const score = (item) => (Number(item.elevation)||0) + (/本丸|本郭|主郭|上郭|山頂/.test(item.id||item.name||"")?100:0);
      return score(right)-score(left);
    })[0];
    const insideBailey = (item,bailey) => bailey && Math.abs((item.x||0)-(bailey.x||0)) <= Number(bailey.width||bailey.w||0)/2+.1 && Math.abs((item.z||0)-(bailey.z||0)) <= Number(bailey.depth||bailey.d||0)/2+.1;
    const halls = (battle.structures || layout.structures || []).filter((item) => ["hall","keep"].includes(item.kind||item.type));
    const mainHall = halls.slice().sort((left,right) => {
      const score = (item) => (insideBailey(item,mainBailey)?1000:0) + (Number(item.w||item.width)||0)*(Number(item.d||item.depth)||0) - (item.z||0)*.05;
      return score(right)-score(left);
    })[0];
    const principal = kind === "keep" || kind === "hall" && (!mainHall || mainHall.id === structure.id);
    const innerWall = insideBailey(structure,mainBailey);
    const rotation = -(structure.rotation || 0);
    let meshCount = 0;
    let seed = 2166136261;
    for (const character of String(structure.id || kind)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    const random = () => { seed = Math.imul(1664525, seed) + 1013904223 >>> 0; return seed / 4294967296; };
    const track = (geometry) => { options.trackGeometry?.(geometry); return geometry; };
    const mesh = (parent, geometry, material, x = 0, y = 0, z = 0) => {
      const item = new THREE.Mesh(track(geometry), material);
      item.position.set(x, y, z);
      item.castShadow = item.receiveShadow = true;
      parent.add(item); meshCount++;
      return item;
    };
    const box = (parent, material, x, y, z, w, h, d) => mesh(parent, new THREE.BoxGeometry(Math.max(.008, w), Math.max(.008, h), Math.max(.008, d)), material, x, y, z);
    const surface = (parent, vertices, uv, indices, material) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      return mesh(parent, geometry, material);
    };
    const beam = (parent, material, start, end, thickness = .08, d = thickness) => {
      const direction = new THREE.Vector3(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
      const length = direction.length();
      if (length < .001) return null;
      const item = box(parent, material, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2, thickness, length, d);
      item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      return item;
    };
    const ground = (x, z) => {
      const worldX = (structure.x || 0) + x * Math.cos(rotation) + z * Math.sin(rotation);
      const worldZ = (structure.z || 0) - x * Math.sin(rotation) + z * Math.cos(rotation);
      return (Number(heightAt(worldX, worldZ)) || 0) - centerHeight;
    };

    // A closed battered foundation: the entire base stays inside the rules'
    // footprint, so stonework never visually narrows a carved gate passage.
    function foundation(parent, w, d, h, y = 0, stone = stoneFort) {
      const top = stone ? .82 : .68;
      const verts = [-w/2,y,-d/2,w/2,y,-d/2,w/2,y,d/2,-w/2,y,d/2,
        -w/2*top,y+h,-d/2*top,w/2*top,y+h,-d/2*top,w/2*top,y+h,d/2*top,-w/2*top,y+h,d/2*top];
      surface(parent, verts, [0,0,w,0,w,d,0,d,0,h,w,h,w,d+h,0,d+h], [0,1,2,0,2,3,0,5,1,0,4,5,1,6,2,1,5,6,2,7,3,2,6,7,3,4,0,3,7,4,4,6,5,4,7,6], stone ? materials.stone : materials.earth);
      if (!stone || w < .5 || d < .5) return;
      // Uneven masonry courses have real silhouettes and shadowed joints.
      const rows = Math.max(1, Math.min(4, Math.ceil(h / .45)));
      for (let row = 0; row < rows; row++) {
        const fy = (row + .5) / rows, taper = 1 - (1 - top) * fy;
        const rowHeight = h / rows * .83;
        for (let face = 0; face < 4; face++) {
          const horizontal = face < 2;
          const length = (horizontal ? w : d) * taper;
          const count = Math.max(1, Math.min(10, Math.ceil(length / .75)));
          const cell = length / count;
          for (let index = 0; index < count; index++) {
            const offset = -length/2 + (index + .5) * cell;
            const x = horizontal ? offset : (face === 2 ? -1 : 1) * Math.max(0,w/2*taper-.04);
            const z = horizontal ? (face === 0 ? -1 : 1) * Math.max(0,d/2*taper-.04) : offset;
            const block = box(parent, index % 7 === 2 && row % 2 ? materials.earth : materials.stone,
              x, y + fy*h, z, horizontal ? cell*(.86 + random()*.08) : .075,
              rowHeight*(.85+random()*.18), horizontal ? .075 : cell*(.86+random()*.08));
            block.rotation.z = (random() - .5) * .10;
            block.rotation.x = (random() - .5) * .08;
          }
        }
      }
    }

    function roof(parent, w, d, y, rise, hip = true) {
      const hw = w/2, hd = d/2, segmentsX = 10, segmentsZ = 12;
      const ridgeEnd = hip ? Math.max(0, hw - hd*.74) : hw;
      const elevation = (x, z) => {
        const tx = hip ? Math.max(0, (Math.abs(x)-ridgeEnd) / Math.max(.1, hw-ridgeEnd)) : 0;
        const tz = Math.abs(z)/hd;
        const t = Math.min(1, Math.max(tz, tx));
        return y + rise * Math.pow(Math.max(0, 1-t), .93) + Math.min(.17, rise*.13)*Math.pow(t, 7) + .055*Math.pow(Math.abs(x)/hw, 8);
      };
      const vertices=[], uv=[], indices=[];
      for(let row=0;row<=segmentsZ;row++) for(let column=0;column<=segmentsX;column++) {
        const x=-hw+w*column/segmentsX,z=-hd+d*row/segmentsZ;
        vertices.push(x,elevation(x,z),z);uv.push(column/segmentsX*w*.5,row/segmentsZ*d*.5);
      }
      for(let row=0;row<segmentsZ;row++) for(let column=0;column<segmentsX;column++) {
        const a=row*(segmentsX+1)+column,b=a+1,c=a+segmentsX+1,e=c+1;
        indices.push(a,c,b,b,c,e);
      }
      const roofSurface=surface(parent,vertices,uv,indices,materials.roof);
      roofSurface.name="castle-curved-roof";
      const underside=vertices.map((value,index)=>index%3===1?value-.075:value);
      const backFaces=[];
      for(let index=0;index<indices.length;index+=3) backFaces.push(indices[index],indices[index+2],indices[index+1]);
      const soffit=surface(parent,underside,uv,backFaces,materials.darkWood);
      soffit.name="castle-roof-soffit";
      // Thin curved fascia and exposed rafter tails retain detail at close zoom.
      for(const side of [-1,1]) {
        const points=[];
        for(let index=0;index<=segmentsX;index++) {
          const x=-hw+w*index/segmentsX;points.push([x,elevation(x,side*hd)-.035,side*hd]);
        }
        for(let index=0;index<segmentsX;index++) beam(parent,materials.darkWood,points[index],points[index+1],.10,.09);
      }
      for (const side of [-1,1]) {
        for(let index=0;index<segmentsZ;index++) {
          const za=-hd+d*index/segmentsZ,zb=-hd+d*(index+1)/segmentsZ;
          beam(parent,materials.darkWood,[side*hw,elevation(side*hw,za)-.035,za],[side*hw,elevation(side*hw,zb)-.035,zb],.10,.09);
        }
      }
      const count=Math.max(4,Math.min(14,Math.round(w/.47)));
      for(let index=0;index<=count;index++) {
        const x=-hw+w*index/count;
        for(const side of [-1,1]) {
          const za=side*hd*.72,zb=side*(hd+.11);
          beam(parent,materials.wood,[x,elevation(x,za)-.1,za],[x,elevation(x,side*hd)-.1,zb],.055,.075);
        }
      }
      // Raised ridge, stacked ridge tiles and a discreet end cap (no late-Edo
      // decorative shachihoko on mid-sixteenth-century mountain fortresses).
      const ridgeLength=Math.max(w*.22,hip ? ridgeEnd*2 : w-.15);
      box(parent,mountain ? materials.darkWood : materials.roof,0,y+rise+.075,0,ridgeLength,.15,.19);
      box(parent,materials.roof,0,y+rise+.175,0,ridgeLength*.96,.055,.12);
      for(const side of [-1,1]) box(parent,materials.darkWood,side*ridgeLength/2,y+rise+.15,0,.075,.23,.24);
      if (!hip) {
        for(const side of [-1,1]) {
          const x=side*(hw-.045);
          const v=[x,y+.09,-hd,x,y+rise,0,x,y+.09,hd];
          surface(parent,v,[0,0,.5,1,1,0],side<0?[0,2,1]:[0,1,2],mountain?materials.wood:materials.plaster);
          beam(parent,materials.darkWood,[x,y+.07,-hd],[x,y+rise,0],.10,.13);
          beam(parent,materials.darkWood,[x,y+rise,0],[x,y+.07,hd],.10,.13);
        }
      }
    }

    function wallPanels(parent,w,d,y,h,plastered=true) {
      box(parent,plastered?materials.plaster:materials.wood,0,y+h/2,0,w,h,d);
      const posts=Math.max(2,Math.min(12,Math.ceil(w/1.4)));
      for (const sign of [-1,1]) {
        for(let p=0;p<=posts;p++) box(parent,materials.darkWood,-w/2+w*p/posts,y+h/2,sign*(d/2+.025),.10,h+.04,.085);
        for(const ratio of [.12,.53,.94]) box(parent,materials.darkWood,0,y+h*ratio,sign*(d/2+.035),w,.075,.09);
        // Horizontal weatherboards protect the lower walls from rain splash.
        for(let board=0;board<4;board++) box(parent,board%3?materials.wood:materials.darkWood,0,y+.12+board*.14,sign*(d/2+.07),w-.06,.13,.065);
        const windows=Math.max(1,Math.min(6,Math.floor(w/1.6)));
        for(let i=0;i<windows;i++) {
          const x=-w/2+w*(i+.5)/windows,ww=Math.min(.7,w/windows*.45),yy=y+h*.66;
          box(parent,materials.darkWood,x,yy,sign*(d/2+.075),ww,h*.29,.055);
          for(let bar=1;bar<=3;bar++) box(parent,materials.wood,x-ww/2+ww*bar/4,yy,sign*(d/2+.11),.035,h*.29+.04,.035);
          box(parent,materials.wood,x,yy+h*.16,sign*(d/2+.12),ww+.1,.06,.065);
        }
      }
      for(const sign of [-1,1]) {
        box(parent,materials.darkWood,sign*(w/2+.02),y+h/2,0,.09,.075,d);
        for(const z of [-d/2+.08,d/2-.08]) box(parent,materials.darkWood,sign*(w/2+.025),y+h/2,z,.085,h,.10);
      }
    }

    let door=null;
    if (kind === "wall" || kind === "palisade") {
      const alongX=width>=depth,length=alongX?width:depth,thickness=alongX?depth:width;
      // Defensive boundaries retain the exact original footprint and HP. Most
      // enclosing walls are rendered as substantial roof-capped earthen walls;
      // outer mountain approaches retain a stout timber stockade.
      const roofedWall = kind === "wall" || innerWall || !mountain || stoneFort || mixedFort || (Number(profile.baileys)||0)>=4;
      const count=Math.max(1,Math.ceil(length/(roofedWall?.72:.38)));
      const cell=length/count;
      for(let index=0;index<count;index++) {
        const offset=-length/2+cell*(index+.5),x=alongX?offset:0,z=alongX?0:offset,y=ground(x,z);
        const segment=new THREE.Group();segment.position.set(x,0,z);group.add(segment);
        if(!roofedWall) {
          foundation(segment,alongX?cell:thickness,alongX?thickness:cell,.48,y,false);
          const h=(height-.16)*(.98+random()*.04),radius=Math.min(thickness*.28,.16);
          mesh(segment,new THREE.CylinderGeometry(radius*.90,radius,h,6),index%8===0?materials.darkWood:materials.wood,0,y+.18+h/2,0);
          mesh(segment,new THREE.CylinderGeometry(0,radius*.91,.27,6),materials.wood,0,y+.18+h+.10,0);
          for(const ratio of [.27,.65,.88]) box(segment,materials.darkWood,0,y+.2+h*ratio,0,alongX?cell+.025:.12,.13,alongX?.12:cell+.025);
        } else {
          const baseHeight=height*(stoneFort?.38:.28),parapetHeight=height-baseHeight;
          foundation(segment,alongX?cell:thickness,alongX?thickness:cell,baseHeight,y,stoneFort||mixedFort);
          const bodyThickness=Math.max(.20,thickness*.70);
          const w=alongX?cell:bodyThickness,d=alongX?bodyThickness:cell;
          box(segment,mountain&&!stoneFort?materials.earth:materials.plaster,0,y+baseHeight+parapetHeight/2,0,w,parapetHeight,d);
          for(const ratio of [.10,.92]) box(segment,materials.darkWood,0,y+baseHeight+parapetHeight*ratio,0,w+.012,.09,d+.012);
          const slitY=y+baseHeight+parapetHeight*.65;
          if(alongX) for(const side of [-1,1]) {
            box(segment,materials.darkWood,0,slitY,side*(d/2+.009),.075,parapetHeight*.31,.018);
            // Timber/stone buttresses stand within the same collision width.
            if(index%3===0) box(segment,stoneFort?materials.stone:materials.darkWood,0,y+height*.42,side*(thickness*.38),.12,height*.84,thickness*.16);
          } else for(const side of [-1,1]) {
            box(segment,materials.darkWood,side*(w/2+.009),slitY,0,.018,parapetHeight*.31,.075);
            if(index%3===0) box(segment,stoneFort?materials.stone:materials.darkWood,side*(thickness*.38),y+height*.42,0,thickness*.16,height*.84,.12);
          }
          // A continuous small gabled tile coping reads as an actual castle
          // wall rather than a row of thin garden stakes.
          const halfAcross=thickness*.49,halfAlong=cell*.51,capY=y+height+.03,rise=.24;
          const v=alongX?[-halfAlong,capY,-halfAcross,halfAlong,capY,-halfAcross,-halfAlong,capY+rise,0,halfAlong,capY+rise,0,-halfAlong,capY,halfAcross,halfAlong,capY,halfAcross]
            :[-halfAcross,capY,-halfAlong,-halfAcross,capY,halfAlong,0,capY+rise,-halfAlong,0,capY+rise,halfAlong,halfAcross,capY,-halfAlong,halfAcross,capY,halfAlong];
          const topIndices=alongX?[0,2,1,1,2,3,2,4,3,3,4,5]:[0,1,2,1,3,2,2,3,4,3,5,4];
          surface(segment,v,[0,0,cell,0,0,.5,cell,.5,0,1,cell,1],topIndices,materials.roof).name="castle-wall-tile-coping";
          box(segment,materials.roof,0,capY+rise+.035,0,alongX?cell+.02:.12,.08,alongX?.12:cell+.02);
        }
      }
      group.userData.enclosureStyle=roofedWall?"roofed-earth-wall":"outer-timber-stockade";
    } else if (kind === "gate") {
      // Kabukimon / modest yaguramon: the traversable opening is only occupied
      // by the separate dynamic double-door group, removed by existing combat.
      const post=.32,clearWidth=Math.max(.3,width-post*2),lintelY=Math.max(2.65,height*.71);
      for(const side of [-1,1]) {
        const x=side*(width/2-post/2);
        box(group,materials.stone,x,.25,0,post*1.10,.5,Math.min(depth,.78));
        box(group,materials.darkWood,x,lintelY/2,0,post,lintelY,.43);
        box(group,materials.wood,x,lintelY*.93,0,post+.15,.22,.64);
        for(const z of [-depth*.36,depth*.36]) {
          box(group,materials.darkWood,x,lintelY*.36,z,.16,lintelY*.72,.16);
          beam(group,materials.wood,[x,.36,z],[x,lintelY*.82,0],.14,.14);
        }
      }
      box(group,materials.darkWood,0,lintelY,0,width+.24,.39,.62);
      box(group,materials.darkWood,0,lintelY+.24,0,width+.45,.22,Math.max(.83,depth*.94));
      const upperHeight=Math.max(1.25,height*.31),upperY=lintelY+.34;
      wallPanels(group,width+.16,Math.max(1.10,depth*.96),upperY,upperHeight,!mountain||stoneFort);
      for(const side of [-1,1]) box(group,materials.darkWood,0,upperY+.13,side*Math.max(.57,depth*.52),width+.28,.19,.13);
      roof(group,width+1.4,Math.max(2.15,depth+1.25),upperY+upperHeight-.04,.93,false);
      group.userData.architecture="fortified-yagura-gate";
      group.userData.storeys=2;
      door=new THREE.Group();door.name="castle-dynamic-double-door";door.position.y=.10;group.add(door);
      const doorHeight=lintelY-.20;
      for(const side of [-1,1]) {
        const leafWidth=clearWidth/2-.025,leafX=side*(clearWidth/4);
        const planks=Math.max(3,Math.min(9,Math.round(leafWidth/.18)));
        for(let plank=0;plank<planks;plank++) box(door,plank%5?materials.wood:materials.darkWood,leafX-leafWidth/2+(plank+.5)*leafWidth/planks,doorHeight/2,0,leafWidth/planks-.008,doorHeight,.15);
        for(const ratio of [.16,.51,.86]) {
          box(door,materials.iron,leafX,doorHeight*ratio,.093,leafWidth*.94,.085,.035);
          for(const offset of [-.37,0,.37]) mesh(door,new THREE.CylinderGeometry(.035,.035,.032,6),materials.iron,leafX+leafWidth*offset,doorHeight*ratio,.12).rotation.x=Math.PI/2;
        }
        box(door,materials.darkWood,side*.06,doorHeight/2,.115,.075,doorHeight*.93,.055);
      }
    } else if(kind === "bridge") {
      const planks=Math.max(3,Math.min(70,Math.ceil(depth/.28)));
      for(let index=0;index<planks;index++) {
        const z=-depth/2+depth*(index+.5)/planks;
        box(group,index%8?materials.wood:materials.darkWood,0,.22,z,width,.15,depth/planks-.012);
      }
      for(const side of [-1,1]) {
        const x=side*(width/2-.10);
        box(group,materials.darkWood,x,.04,0,.18,.25,depth+.06);
        for(const y of [.58,.94]) box(group,materials.darkWood,x,y,0,.07,.075,depth+.02);
        const supports=Math.max(3,Math.min(12,Math.ceil(depth/1.5)));
        for(let index=0;index<=supports;index++) box(group,materials.wood,x,.57,-depth/2+depth*index/supports,.12,.97,.12);
      }
    } else if(kind === "watchtower") {
      // Enclosed two-storey corner turret, with a battered low footing and
      // substantial boarded ground floor instead of an exposed scaffold hut.
      const baseHeight=stoneFort?1.0:.76,lowerHeight=Math.max(2.0,height*.49),upperHeight=Math.max(1.48,height*.35);
      foundation(group,width,depth,baseHeight,0,stoneFort||mixedFort);
      const lowerW=width*.84,lowerD=depth*.84;
      wallPanels(group,lowerW,lowerD,baseHeight,lowerHeight,false);
      for(const sign of [-1,1]) box(group,materials.darkWood,0,baseHeight+lowerHeight*.48,sign*(lowerD/2+.10),lowerW+.14,.16,.16);
      const lowerRoofY=baseHeight+lowerHeight-.02;
      roof(group,lowerW+.78,lowerD+.78,lowerRoofY,.67,true);
      const upperY=lowerRoofY+.41,upperW=lowerW*.88,upperD=lowerD*.88;
      wallPanels(group,upperW,upperD,upperY,upperHeight,!mountain||stoneFort);
      box(group,materials.darkWood,0,upperY+.09,0,upperW+.15,.15,upperD+.15);
      roof(group,upperW+.95,upperD+.95,upperY+upperHeight-.03,.91,false);
      group.userData.architecture="enclosed-double-turret";
      group.userData.storeys=2;
    } else {
      const foundationHeight=principal?(stoneFort?1.22:mixedFort?1.04:.86):(stoneFort?.72:.49);
      foundation(group,width,depth,foundationHeight,0,stoneFort||mixedFort);
      const buildingWidth=width*.87,buildingDepth=depth*.84;
      if(principal) {
        // A fortified main residence/turret compound: repeated roof levels and
        // recessed upper storeys provide a castle silhouette at battle distance.
        // Mountain versions remain dark boarded medieval towers, rather than
        // copying a huge white Edo-period keep into every sixteenth-century site.
        const thirdStorey=!mountain&&width>=9.5&&(stoneFort||mixedFort||(Number(profile.baileys)||0)>=4);
        const lowerHeight=Math.max(2.30,height*.82),upperHeight=thirdStorey?1.78:2.10;
        wallPanels(group,buildingWidth,buildingDepth,foundationHeight,lowerHeight,!mountain);
        const lowerRoofY=foundationHeight+lowerHeight-.06;
        roof(group,buildingWidth+1.16,buildingDepth+1.04,lowerRoofY,Math.min(1.24,buildingDepth*.31),true);
        const upperY=lowerRoofY+.62,upperW=buildingWidth*.68,upperD=buildingDepth*.69;
        wallPanels(group,upperW,upperD,upperY,upperHeight,!mountain||stoneFort);
        box(group,materials.darkWood,0,upperY+.11,0,upperW+.23,.19,upperD+.23);
        roof(group,upperW+1.13,upperD+1.03,upperY+upperHeight-.05,Math.min(1.11,upperD*.43),thirdStorey);
        if(thirdStorey) {
          const crownY=upperY+upperHeight+.43,crownW=upperW*.65,crownD=upperD*.72;
          wallPanels(group,crownW,crownD,crownY,1.52,true);
          roof(group,crownW+1.08,crownD+.98,crownY+1.47,Math.min(.96,crownD*.48),false);
        }
        // Heavy veranda, thick corner posts and shallow lower awnings connect
        // the main tower to the residence rather than leaving an isolated box.
        for(const sign of [-1,1]) {
          box(group,materials.darkWood,0,foundationHeight+.14,sign*(buildingDepth/2+.15),buildingWidth,.20,.33);
          for(const x of [-buildingWidth*.45,0,buildingWidth*.45]) box(group,materials.darkWood,x,foundationHeight+lowerHeight/2,sign*(buildingDepth/2+.18),.13,lowerHeight,.13);
        }
        group.userData.architecture=thirdStorey?"principal-three-level-residence":"principal-double-residence";
        group.userData.storeys=thirdStorey?3:2;
      } else {
        // Long barracks / retainers' residence with a dense tiled roof and
        // defensive timber galleries. These keep subordinate precincts lower.
        const wallHeight=Math.max(2.20,height*.84);
        wallPanels(group,buildingWidth,buildingDepth,foundationHeight,wallHeight,!mountain);
        roof(group,buildingWidth+1.05,buildingDepth+1.01,foundationHeight+wallHeight-.04,Math.min(1.32,buildingDepth*.36),false);
        for(const sign of [-1,1]) {
          box(group,materials.darkWood,0,foundationHeight+.14,sign*(buildingDepth/2+.12),buildingWidth,.20,.30);
          for(const x of [-buildingWidth*.43,buildingWidth*.43]) box(group,materials.darkWood,x,foundationHeight+wallHeight/2,sign*(buildingDepth/2+.14),.14,wallHeight,.14);
        }
        group.userData.architecture="retainers-longhouse";
        group.userData.storeys=1;
      }
    }
    group.name=`realistic-castle-${kind}`;
    // Rendering and picking use the actual architectural silhouette while the
    // immutable rules structure keeps its original combat height and footprint.
    group.updateMatrixWorld(true);
    let visualHeight=0;
    const corner=new THREE.Vector3();
    group.traverse((item)=>{
      if(!item.isMesh) return;
      item.geometry.computeBoundingBox();
      const bounds=item.geometry.boundingBox;
      if(!bounds) return;
      for(const x of [bounds.min.x,bounds.max.x]) for(const y of [bounds.min.y,bounds.max.y]) for(const z of [bounds.min.z,bounds.max.z]) {
        corner.set(x,y,z).applyMatrix4(item.matrixWorld);
        visualHeight=Math.max(visualHeight,corner.y);
      }
    });
    group.userData.castleModel={kind,terrain,wall:profile.wall||"earth",principal,storeys:group.userData.storeys||0,architecture:group.userData.architecture||group.userData.enclosureStyle,reconstruction:"creative-game-scale",meshCount,visualHeight};
    return { group, door, extras: { kind, terrain, wall: profile.wall||"earth", meshCount, visualHeight } };
  }

  root.TenkaCastleModels=Object.freeze({createStructure});
})(typeof window !== "undefined" ? window : globalThis);
