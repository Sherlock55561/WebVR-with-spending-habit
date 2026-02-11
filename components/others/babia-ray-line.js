/* global AFRAME, THREE */
if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

AFRAME.registerComponent('babia-ray-line', {
    schema: {
        color: { type: 'color', default: '#00bcd4' },
        opacity: { type: 'number', default: 0.7 },
        showWhenNoHit: { type: 'boolean', default: false },
        far: { type: 'number', default: 50 },
        space: { type: 'string', default: 'camera' } // camera | world
    },

    init: function () {
        this.lineEl = document.createElement('a-entity');
        this.lineEl.setAttribute('line', {
            start: '0 0 0',
            end: '0 0 -1',
            color: this.data.color,
            opacity: this.data.opacity
        });
        this.lineEl.setAttribute('visible', false);
        this.cameraEl = null;
        this.attachLine();

        this.start = new THREE.Vector3();
        this.end = new THREE.Vector3();
        this.dir = new THREE.Vector3();
        this.tmp = new THREE.Vector3();

        this.onIntersect = this.onIntersect.bind(this);
        this.onClear = this.onClear.bind(this);
        this.onCameraSetActive = this.attachLine.bind(this);
        this.onExternalHit = this.onExternalHit.bind(this);
        this.externalActiveUntil = 0;
        this.el.addEventListener('raycaster-intersection', this.onIntersect);
        this.el.addEventListener('raycaster-intersection-cleared', this.onClear);
        this.el.addEventListener('babia-points-hit', this.onExternalHit);
        this.el.sceneEl.addEventListener('camera-set-active', this.onCameraSetActive);
    },

    remove: function () {
        this.el.removeEventListener('raycaster-intersection', this.onIntersect);
        this.el.removeEventListener('raycaster-intersection-cleared', this.onClear);
        this.el.removeEventListener('babia-points-hit', this.onExternalHit);
        this.el.sceneEl.removeEventListener('camera-set-active', this.onCameraSetActive);
        if (this.lineEl && this.lineEl.parentNode) {
            this.lineEl.parentNode.removeChild(this.lineEl);
        }
        this.lineEl = null;
    },
    onExternalHit: function (evt) {
        const detail = evt.detail || {};
        if (!detail.point) {
            return;
        }
        this.externalActiveUntil = performance.now() + 100;
        this.attachLine();
        this.el.object3D.getWorldPosition(this.start);
        this.end.copy(detail.point);
        this.updateLine(this.start, this.end);
    },
    attachLine: function () {
        if (!this.lineEl) {
            return;
        }
        this.cameraEl = this.el.sceneEl.camera && this.el.sceneEl.camera.el ? this.el.sceneEl.camera.el : null;
        if (this.data.space === 'camera' && this.cameraEl) {
            if (this.lineEl.parentNode !== this.cameraEl) {
                this.lineEl.parentNode && this.lineEl.parentNode.removeChild(this.lineEl);
                this.cameraEl.appendChild(this.lineEl);
            }
        } else if (this.lineEl.parentNode !== this.el.sceneEl) {
            this.lineEl.parentNode && this.lineEl.parentNode.removeChild(this.lineEl);
            this.el.sceneEl.appendChild(this.lineEl);
        }
    },
    setLineLocal: function (start, end) {
        this.lineEl.setAttribute('line', {
            start: `${start.x} ${start.y} ${start.z}`,
            end: `${end.x} ${end.y} ${end.z}`,
            color: this.data.color,
            opacity: this.data.opacity
        });
        this.lineEl.setAttribute('visible', true);
    },

    updateLine: function (start, end) {
        if (this.data.space === 'camera' && this.cameraEl && this.cameraEl.object3D) {
            const camObj = this.cameraEl.object3D;
            const localStart = camObj.worldToLocal(start.clone());
            const localEnd = camObj.worldToLocal(end.clone());
            this.setLineLocal(localStart, localEnd);
        } else {
            this.setLineLocal(start, end);
        }
    },

    onIntersect: function (evt) {
        if (performance.now() < this.externalActiveUntil) {
            return;
        }
        const intersections = evt.detail.intersections || [];
        if (!intersections.length) {
            return;
        }
        const hit = intersections[0];
        if (!hit || !hit.point) {
            return;
        }
        const rc = this.el.components.raycaster && this.el.components.raycaster.raycaster;
        this.attachLine();
        this.el.object3D.getWorldPosition(this.start);
        let dir = null;
        if (rc && rc.ray && rc.ray.origin && rc.ray.direction) {
            const origin = rc.ray.origin.clone();
            const worldPos = this.start.clone();
            if (origin.distanceTo(worldPos) > 0.01) {
                origin.applyMatrix4(this.el.object3D.matrixWorld);
                this.start.copy(origin);
                dir = rc.ray.direction.clone().transformDirection(this.el.object3D.matrixWorld);
            } else {
                this.start.copy(origin);
                dir = rc.ray.direction;
            }
        }
        this.end.copy(hit.point);
        if (dir) {
            const fromHit = this.end.clone().sub(this.start);
            if (fromHit.lengthSq() < 1e-6) {
                this.end.copy(this.start).addScaledVector(dir, this.data.far);
            }
        }
        this.updateLine(this.start, this.end);
    },

    onClear: function () {
        if (!this.data.showWhenNoHit) {
            if (this.lineEl) {
                this.lineEl.setAttribute('visible', false);
            }
            return;
        }
        const rc = this.el.components.raycaster && this.el.components.raycaster.raycaster;
        if (!rc || !rc.ray) {
            return;
        }
        this.attachLine();
        this.el.object3D.getWorldPosition(this.start);
        const origin = rc.ray.origin.clone();
        const worldPos = this.start.clone();
        if (origin.distanceTo(worldPos) > 0.01) {
            origin.applyMatrix4(this.el.object3D.matrixWorld);
            this.start.copy(origin);
            this.dir.copy(rc.ray.direction).transformDirection(this.el.object3D.matrixWorld).normalize();
        } else {
            this.start.copy(origin);
            this.dir.copy(rc.ray.direction).normalize();
        }
        this.end.copy(this.start).addScaledVector(this.dir, this.data.far);
        this.updateLine(this.start, this.end);
    }
});
