import * as THREE from 'three';

/**
 * XR interaction: laser pointers that hover/press UI, shelf pedestals and
 * the hero's own controls (like the winding key); grip to pick the hero up
 * (near or at a distance); both grips to scale and turn it; A/X to wind,
 * B/Y to put it back; sticks to walk and turn.
 */
export class Interaction {
  constructor(app) {
    this.app = app;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 12;
    this.pointers = {};
    this.grabs = new Map(); // hand -> { offset }
    this.two = null;
    this.turnCooldown = 0;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    for (const side of ['left', 'right']) this.pointers[side] = makePointer(side);
  }

  attach(rig) {
    for (const p of Object.values(this.pointers)) rig.add(p.group);
  }

  /** world-space grip matrix of a hand */
  gripMatrix(hs, target) {
    const src = hs.grip && hs.grip.visible !== false ? hs.grip : hs.ray;
    src.updateWorldMatrix(true, false);
    return target.copy(src.matrixWorld);
  }

  targets() {
    const app = this.app;
    const list = [...app.panel.targets];
    if (app.stage.mode !== 'life') for (const it of app.shelf.items) if (app.shelf.group.visible) list.push(it.proxy);
    if (app.stage.asset) for (const it of app.stage.asset.interactions) list.push(it.proxy);
    return list;
  }

  resolve(object) {
    if (!object) return null;
    if (object.userData.button) return { kind: 'button', button: object.userData.button };
    const item = this.app.shelf.itemFor(object);
    if (item) return { kind: 'shelf', item };
    const asset = this.app.stage.asset;
    if (asset) {
      const it = asset.interactions.find((i) => i.proxy === object);
      if (it) return { kind: 'interaction', interaction: it };
    }
    return null;
  }

  update(dt, hands, rig, camera) {
    const app = this.app;
    const stage = app.stage;
    const targets = this.targets();
    let shelfHover = null;
    for (const side of ['left', 'right']) {
      const hs = hands[side];
      const ptr = this.pointers[side];
      if (!hs.connected) {
        ptr.group.visible = false;
        continue;
      }
      ptr.group.visible = true;
      // ray
      this.raycaster.ray.origin.copy(hs.rayOrigin);
      this.raycaster.ray.direction.copy(hs.rayDir);
      const hits = this.raycaster.intersectObjects(targets, false);
      let hit = hits[0] || null;
      let target = hit ? this.resolve(hit.object) : null;
      // the hero's body is only a grab target (never blocks buttons)
      let heroHit = null;
      if (stage.asset) {
        const h = this.raycaster.intersectObject(stage.bodyProxy, false)[0];
        if (h && (!hit || h.distance < hit.distance)) heroHit = h;
      }
      if (this.grabs.has(side)) target = null;

      // hover feedback
      if (ptr.hover && ptr.hover !== target?.button) ptr.hover.setHover(false);
      ptr.hover = null;
      if (target?.kind === 'button') {
        target.button.setHover(true);
        ptr.hover = target.button;
      }
      if (target?.kind === 'shelf') shelfHover = target.item;
      const key = target ? (target.button || target.item || target.interaction) : null;
      if (key && key !== ptr.lastKey) {
        app.audio.ui('hover');
        hs.pulse(0.15, 12);
      }
      ptr.lastKey = key;

      // trigger
      if (hs.triggerPressed && target) {
        if (target.kind === 'button') {
          target.button.press();
          app.audio.ui('click');
          hs.pulse(0.4, 25);
        } else if (target.kind === 'shelf') {
          if (!target.item.entry.comingSoon) {
            app.audio.ui('select');
            hs.pulse(0.5, 40);
            stage.load(target.item);
          } else {
            app.onStatus?.(`${target.item.entry.name} is still under its dust cloth. Coming soon!`);
            app.audio.ui('click');
          }
        } else if (target.kind === 'interaction') {
          ptr.holding = target.interaction;
          target.interaction.onStart?.();
        }
      }
      if (ptr.holding) {
        if (hs.triggerDown) ptr.holding.onHold?.(dt);
        else {
          ptr.holding.onEnd?.();
          ptr.holding = null;
        }
      }
      // A/X: wind
      if (hs.primary && stage.asset) {
        const wind = stage.asset.interactions.find((i) => i.id === 'wind');
        if (wind) {
          if (hs.primaryPressed) wind.onStart?.();
          wind.onHold?.(dt);
          ptr.windingButton = wind;
        }
      } else if (ptr.windingButton) {
        ptr.windingButton.onEnd?.();
        ptr.windingButton = null;
      }
      // B/Y: tap to put it back on the table, hold to exit
      if (hs.secondary) {
        const before = ptr.bHeld || 0;
        ptr.bHeld = before + dt;
        if (ptr.bHeld > 0.4 && Math.floor(ptr.bHeld * 5) !== Math.floor(before * 5)) hs.pulse(0.1 + Math.min(0.6, ptr.bHeld * 0.4), 20);
        if (ptr.bHeld > 0.4 && before <= 0.4) app.onStatus?.('Keep holding to exit…');
        if (ptr.bHeld >= 1.5 && before < 1.5) {
          hs.pulse(1, 80);
          app.exit();
        }
      } else if (ptr.bHeld) {
        if (ptr.bHeld < 0.4) {
          app.audio.ui('click');
          stage.reset();
        }
        ptr.bHeld = 0;
      }

      // grip: pick up the hero (near the hand, or pointed at)
      if (hs.squeezePressed && stage.asset) {
        const wb = stage.worldBounds(this._p);
        this.gripMatrix(hs, this._m);
        const gp = new THREE.Vector3().setFromMatrixPosition(this._m);
        const near = gp.distanceTo(wb.center) < wb.radius * 1.05 + 0.05;
        if (near || heroHit) this.startGrab(side, hs);
      }
      if (this.grabs.has(side) && !hs.squeezeDown) this.endGrab(side, hands);

      // visuals
      const len = hit ? hit.distance : heroHit ? heroHit.distance : 1.2;
      const active = !!target || !!heroHit;
      ptr.setRay(hs.rayOrigin, hs.rayDir, len, active, this.grabs.has(side), rig);
    }

    // grabbing
    this.updateGrab(hands);

    // locomotion (sticks), not while scaling with both hands
    if (!this.two) this.locomote(dt, hands, rig, camera);
    return shelfHover;
  }

  startGrab(side, hs) {
    const stage = this.app.stage;
    stage.grabbed = true;
    stage.tween = null;
    this.gripMatrix(hs, this._m);
    stage.holder.updateMatrixWorld();
    const offset = this._m.clone().invert().multiply(stage.holder.matrixWorld);
    this.grabs.set(side, { offset, hs });
    hs.pulse(0.5, 30);
    this.app.audio.ui('click');
    if (this.grabs.size === 2) this.beginTwo();
  }

  endGrab(side, hands) {
    this.grabs.delete(side);
    this.two = null;
    const stage = this.app.stage;
    if (this.grabs.size === 1) {
      // continue one-handed with the remaining hand
      const [other, g] = [...this.grabs.entries()][0];
      this.gripMatrix(g.hs, this._m);
      g.offset = this._m.clone().invert().multiply(stage.holder.matrixWorld);
      this.grabs.set(other, g);
    } else {
      stage.grabbed = false;
      this.app.onReleased?.();
    }
  }

  beginTwo() {
    const stage = this.app.stage;
    const [a, b] = [...this.grabs.values()];
    const pa = new THREE.Vector3().setFromMatrixPosition(this.gripMatrix(a.hs, this._m));
    const pb = new THREE.Vector3().setFromMatrixPosition(this.gripMatrix(b.hs, this._m));
    this.two = {
      a,
      b,
      dist0: Math.max(0.02, pa.distanceTo(pb)),
      mid0: pa.clone().add(pb).multiplyScalar(0.5),
      dir0: pb.clone().sub(pa).normalize(),
      pos0: stage.holder.position.clone(),
      quat0: stage.holder.quaternion.clone(),
      scale0: stage.holder.scale.x,
    };
  }

  updateGrab() {
    const stage = this.app.stage;
    if (!this.grabs.size || !stage.asset) return;
    const h = stage.holder;
    if (this.two) {
      const T = this.two;
      const pa = new THREE.Vector3().setFromMatrixPosition(this.gripMatrix(T.a.hs, this._m));
      const pb = new THREE.Vector3().setFromMatrixPosition(this.gripMatrix(T.b.hs, this._m));
      const dist = Math.max(0.02, pa.distanceTo(pb));
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      const dir = pb.clone().sub(pa).normalize();
      const base = stage.scale;
      const s = THREE.MathUtils.clamp((T.scale0 * dist) / T.dist0, base * 0.3, 1.25);
      const k = s / T.scale0;
      const dq = new THREE.Quaternion().setFromUnitVectors(T.dir0, dir);
      h.quaternion.copy(dq).multiply(T.quat0);
      h.position.copy(T.pos0).sub(T.mid0).applyQuaternion(dq).multiplyScalar(k).add(mid);
      h.scale.setScalar(s);
      const now = Math.round(Math.log2(s / base) * 4);
      if (now !== T.lastStep) {
        T.lastStep = now;
        T.a.hs.pulse(0.12, 10);
        T.b.hs.pulse(0.12, 10);
      }
    } else {
      const [g] = this.grabs.values();
      this.gripMatrix(g.hs, this._m);
      this._m2.multiplyMatrices(this._m, g.offset);
      this._m2.decompose(this._p, this._q, this._s);
      h.position.copy(this._p);
      h.quaternion.copy(this._q);
    }
  }

  locomote(dt, hands, rig, camera) {
    const L = hands.left, R = hands.right;
    // right stick: snap turn
    this.turnCooldown -= dt;
    if (R.connected && Math.abs(R.stick.x) > 0.6 && this.turnCooldown <= 0) {
      this.turnCooldown = 0.35;
      const ang = -Math.sign(R.stick.x) * (Math.PI / 6);
      const head = new THREE.Vector3();
      camera.getWorldPosition(head);
      rig.position.sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).add(head);
      rig.rotation.y += ang;
    }
    if (R.connected && Math.abs(R.stick.x) < 0.3) this.turnCooldown = Math.min(this.turnCooldown, 0);
    // right stick up / down: rise and sink in the big views, to look over
    // the walls of the snow-globe town or down into the carousel's canopy
    const stage = this.app.stage;
    if (stage.mode === 'life' && R.connected && Math.abs(R.stick.y) > 0.25 && Math.abs(R.stick.x) < 0.6) {
      const L2 = stage.asset?.info.life || {};
      const lift = L2.lift ?? 3;
      rig.position.y = THREE.MathUtils.clamp(rig.position.y - R.stick.y * 1.3 * dt, 0, lift);
    }
    // left stick: smooth walk, head-relative
    if (L.connected && (Math.abs(L.stick.x) > 0.1 || Math.abs(L.stick.y) > 0.1)) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const speed = 1.6;
      rig.position.addScaledVector(fwd, -L.stick.y * speed * dt).addScaledVector(right, L.stick.x * speed * dt);
      const max = 8.3;
      const r = Math.hypot(rig.position.x, rig.position.z);
      if (r > max) rig.position.multiplyScalar(max / r);
    }
  }
}

/** simple brass "wand" controller with a soft laser */
function makePointer(side) {
  const group = new THREE.Group();
  group.name = `pointer:${side}`;
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.5, toneMapped: false });
  const line = new THREE.Line(lineGeo, lineMat);
  group.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false }));
  group.add(dot);
  const wand = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.4 }));
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.05;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd9a84e, metalness: 1, roughness: 0.25 }));
  wand.add(body, tip);
  group.add(wand);
  const _q = new THREE.Quaternion();
  const _z = new THREE.Vector3(0, 0, -1);
  const _inv = new THREE.Matrix4();
  const _o = new THREE.Vector3();
  const _d = new THREE.Vector3();
  return {
    group,
    hover: null,
    lastKey: null,
    holding: null,
    windingButton: null,
    setRay(origin, dir, len, active, grabbing, rig) {
      // group lives in rig space; convert world ray into it
      rig.updateMatrixWorld();
      _inv.copy(rig.matrixWorld).invert();
      _o.copy(origin).applyMatrix4(_inv);
      _d.copy(dir).transformDirection(_inv);
      line.position.copy(_o);
      wand.position.copy(_o);
      _q.setFromUnitVectors(_z, _d);
      line.quaternion.copy(_q);
      wand.quaternion.copy(_q);
      line.scale.set(1, 1, len / rig.scale.x);
      lineMat.opacity = grabbing ? 0.08 : active ? 0.85 : 0.35;
      lineMat.color.set(active ? 0xffd38a : 0xfff2dc);
      dot.visible = active && !grabbing;
      dot.position.copy(_o).addScaledVector(_d, len);
    },
  };
}
