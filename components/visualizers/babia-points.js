let updateFunction = require('../others/common').updateFunction;
const colors = require('../others/common').colors;
const NotiBuffer = require("../../common/noti-buffer").NotiBuffer;

/* global AFRAME, THREE */
if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

AFRAME.registerComponent('babia-points', {
    schema: {
        data: { type: 'string' },
        from: { type: 'string' },
        x: { type: 'string', default: 'x' },
        y: { type: 'string', default: 'y' },
        z: { type: 'string', default: 'z' },
        color: { type: 'string' },
        colorMode: { type: 'string', default: 'field' }, // field | pca
        mode: { type: 'string', default: '' }, // '' | pca | gmm
        pcaX: { type: 'string', default: 'PCA1' },
        pcaY: { type: 'string', default: 'PCA2' },
        pcaZ: { type: 'string', default: 'PCA3' },
        gmmX: { type: 'string', default: 'GMM_Prob_0' },
        gmmY: { type: 'string', default: 'GMM_Prob_1' },
        gmmZ: { type: 'string', default: 'GMM_Prob_2' },
        pcaColors: { type: 'string', default: '#ff0000,#0000ff,#00ff00' },
        size: { type: 'number', default: 0.02 },
        opacity: { type: 'number', default: 1 },
        palette: { type: 'string', default: 'ubuntu' },
        colorMin: { type: 'string', default: '#2b83ba' },
        colorMax: { type: 'string', default: '#d7191c' },
        box: { type: 'number', default: 2 },
        center: { type: 'boolean', default: true },
        filterField: { type: 'string', default: '' },
        filterValues: { type: 'string', default: '' },
        shape: { type: 'string', default: 'point' }, // point | sphere
        sphereSegments: { type: 'number', default: 6 },
        sphereInstanced: { type: 'boolean', default: false },
        debug: { type: 'boolean', default: false }
    },

    multiple: false,

    /**
     * List of visualization properties (for babia-ui).
     */
    visProperties: ['x', 'y', 'z', 'color'],

    init: function () {
        this.notiBuffer = new NotiBuffer();
        this.pointsObj = null;
        this.raycastObj = null;
        this.baseColors = null;
        this.highlightIndex = null;
        this.pointPositions = null;
        this._debugLogged = false;
        this.el.classList.add('babia-points-target');
    },

    update: function (oldData) {
        updateFunction(this, oldData);
    },

    prodComponent: undefined,
    notiBufferId: undefined,
    newData: undefined,

    processData: function (data) {
        this.newData = data;
        this.buildPoints();
        if (this.notiBuffer) {
            this.notiBuffer.set(this.newData);
        }
    },

    remove: function () {
        this.disposePoints();
    },

    disposePoints: function () {
        if (!this.pointsObj && !this.raycastObj) {
            return;
        }
        if (this.pointsObj) {
            this.el.removeObject3D('mesh');
            if (this.pointsObj.isGroup && this.pointsObj.children && this.pointsObj.children.length) {
                this.pointsObj.children.forEach(child => {
                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                    if (child.material) {
                        child.material.dispose();
                    }
                });
            } else {
                if (this.pointsObj.geometry) {
                    this.pointsObj.geometry.dispose();
                }
                if (this.pointsObj.material) {
                    this.pointsObj.material.dispose();
                }
            }
        }
        if (this.raycastObj && (!this.pointsObj || this.raycastObj.parent !== this.pointsObj)) {
            if (this.raycastObj.geometry) {
                this.raycastObj.geometry.dispose();
            }
            if (this.raycastObj.material) {
                this.raycastObj.material.dispose();
            }
        }
        this.pointsObj = null;
        this.raycastObj = null;
        this.baseColors = null;
        this.highlightIndex = null;
        this.pointPositions = null;
        this.activeKeys = null;
    },

    refreshRaycasters: function () {
        const scene = this.el.sceneEl;
        if (!scene) {
            return;
        }
        const raycasters = scene.querySelectorAll('[raycaster]');
        for (let i = 0; i < raycasters.length; i++) {
            const comp = raycasters[i].components && raycasters[i].components.raycaster;
            if (comp && comp.refreshObjects) {
                comp.refreshObjects();
            }
        }
    },

    _getQueryFlag: function (name) {
        try {
            if (typeof window === 'undefined' || !window.location || !window.location.search) {
                return null;
            }
            const params = new URLSearchParams(window.location.search);
            if (!params.has(name)) {
                return null;
            }
            const raw = (params.get(name) || '').toLowerCase();
            if (raw === '' || raw === '1' || raw === 'true' || raw === 'yes') {
                return true;
            }
            if (raw === '0' || raw === 'false' || raw === 'no') {
                return false;
            }
            return true;
        } catch (e) {
            return null;
        }
    },

    buildPoints: function () {
        const data = this.data;
        const debug = data.debug || this._getQueryFlag('babiaDebug');
        const rows = this.newData || [];
        const filterField = (data.filterField || '').trim();
        const filterValuesRaw = (data.filterValues || '').trim();
        const filterValues = filterValuesRaw
            ? filterValuesRaw.split(',').map(v => v.trim()).filter(v => v.length > 0)
            : [];

        const mode = (data.mode || '').toLowerCase().trim();
        let xKey = data.x;
        let yKey = data.y;
        let zKey = data.z;
        if (mode === 'pca') {
            xKey = data.pcaX || xKey;
            yKey = data.pcaY || yKey;
            zKey = data.pcaZ || zKey;
        } else if (mode === 'gmm') {
            xKey = data.gmmX || xKey;
            yKey = data.gmmY || yKey;
            zKey = data.gmmZ || zKey;
        }
        const cKey = data.color;
        this.activeKeys = { x: xKey, y: yKey, z: zKey, color: cKey, mode: mode };

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let validCount = 0;
        let validIndexMap = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (filterField && filterValues.length) {
                const val = row[filterField];
                if (val === undefined || val === null || filterValues.indexOf(String(val)) === -1) {
                    continue;
                }
            }
            const x = Number(row[xKey]);
            const y = Number(row[yKey]);
            const z = Number(row[zKey]);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
                continue;
            }
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
            validCount++;
            validIndexMap.push(i);
        }

        if (validCount === 0) {
            console.warn('babia-points: no valid rows for x/y/z');
            this.disposePoints();
            return;
        }

        const spanX = maxX - minX || 1;
        const spanY = maxY - minY || 1;
        const spanZ = maxZ - minZ || 1;
        const box = data.box;
        const half = box / 2;

        let colorIsNumeric = false;
        let cMin = Infinity;
        let cMax = -Infinity;
        let categoryMap = {};
        let categoryIndex = 0;

        if (cKey && data.colorMode !== 'pca') {
            colorIsNumeric = true;
            for (let i = 0; i < rows.length; i++) {
                const value = rows[i][cKey];
                const num = Number(value);
                if (!isFinite(num)) {
                    colorIsNumeric = false;
                    break;
                }
                if (num < cMin) cMin = num;
                if (num > cMax) cMax = num;
            }
            if (colorIsNumeric && cMin === Infinity) {
                colorIsNumeric = false;
            }
        }

        const positions = new Float32Array(validCount * 3);
        const colorsArr = new Float32Array(validCount * 3);
        const colorA = new THREE.Color(data.colorMin);
        const colorB = new THREE.Color(data.colorMax);
        const pcaPalette = data.pcaColors.split(',').map(c => c.trim()).filter(Boolean);
        const pcaColorA = new THREE.Color(pcaPalette[0] || '#e74c3c');
        const pcaColorB = new THREE.Color(pcaPalette[1] || '#2ecc71');
        const pcaColorC = new THREE.Color(pcaPalette[2] || '#3498db');

        let idx = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (filterField && filterValues.length) {
                const val = row[filterField];
                if (val === undefined || val === null || filterValues.indexOf(String(val)) === -1) {
                    continue;
                }
            }
            const x = Number(row[xKey]);
            const y = Number(row[yKey]);
            const z = Number(row[zKey]);
            if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
                continue;
            }

            const nx = (x - minX) / spanX;
            const ny = (y - minY) / spanY;
            const nz = (z - minZ) / spanZ;

            positions[idx * 3] = data.center ? (nx * box - half) : (nx * box);
            positions[idx * 3 + 1] = data.center ? (ny * box - half) : (ny * box);
            positions[idx * 3 + 2] = data.center ? (nz * box - half) : (nz * box);

            let color = new THREE.Color('#ff5733');
            if (data.colorMode === 'pca') {
                const ax = Math.abs(x);
                const ay = Math.abs(y);
                const az = Math.abs(z);
                if (ax >= ay && ax >= az) {
                    color = pcaColorA;
                } else if (ay >= ax && ay >= az) {
                    color = pcaColorB;
                } else {
                    color = pcaColorC;
                }
            } else if (cKey) {
                const raw = row[cKey];
                if (colorIsNumeric) {
                    const num = Number(raw);
                    const t = (num - cMin) / (cMax - cMin || 1);
                    color = colorA.clone().lerp(colorB, Math.min(Math.max(t, 0), 1));
                } else {
                    const key = String(raw);
                    if (categoryMap[key] === undefined) {
                        categoryMap[key] = categoryIndex++;
                    }
                    color = new THREE.Color(colors.get(categoryMap[key], data.palette));
                }
            }
            colorsArr[idx * 3] = color.r;
            colorsArr[idx * 3 + 1] = color.g;
            colorsArr[idx * 3 + 2] = color.b;

            idx++;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));

        if (debug) {
            const sample = Array.from(colorsArr.slice(0, Math.min(9, colorsArr.length)));
            const nonZero = sample.filter(v => v > 0).length;
            console.log('babia-points debug: colorMode', data.colorMode, 'mode', mode, 'pcaColors', data.pcaColors, 'sample', JSON.stringify(sample), 'nonZero', nonZero);
        }

        this.disposePoints();
        this.pointPositions = positions;
        this.baseColors = colorsArr.slice();
        this.highlightIndex = null;

        if (debug && !this._debugLogged) {
            this._debugLogged = true;
            const scene = this.el.sceneEl;
            const renderer = scene && scene.renderer;
            const caps = renderer && renderer.capabilities;
            const ext = renderer && renderer.extensions;
            console.log('babia-points debug', {
                aframe: (typeof AFRAME !== 'undefined' && AFRAME.version) ? AFRAME.version : 'unknown',
                three: (typeof THREE !== 'undefined' && THREE.REVISION) ? THREE.REVISION : 'unknown',
                webgl2: caps ? caps.isWebGL2 : 'unknown',
                angleInstanced: ext ? !!ext.get('ANGLE_instanced_arrays') : 'unknown'
            });
        }

        const instancedOverride = this._getQueryFlag('babiaInstanced');
        const useInstanced = (instancedOverride === null) ? data.sphereInstanced : instancedOverride;
        if (debug && instancedOverride !== null && instancedOverride !== data.sphereInstanced) {
            console.log('babia-points debug: sphereInstanced override', {
                from: data.sphereInstanced,
                to: instancedOverride
            });
        }

        if (data.shape === 'sphere') {
            const radius = Math.max(0.0001, data.size);
            const segments = Math.max(3, data.sphereSegments || 6);
            let mesh = null;
            if (useInstanced) {
                try {
                    const sphereGeo = new THREE.SphereGeometry(radius, segments, segments);
                    // Ensure a per-vertex color attribute exists so instanceColor can modulate it.
                    if (!sphereGeo.getAttribute('color')) {
                        const vertCount = sphereGeo.getAttribute('position').count;
                        const white = new Float32Array(vertCount * 3);
                        white.fill(1);
                        sphereGeo.setAttribute('color', new THREE.BufferAttribute(white, 3));
                    }
                    const sphereMat = new THREE.MeshBasicMaterial({
                        vertexColors: true,
                        transparent: data.opacity < 1,
                        opacity: data.opacity
                    });
                    sphereMat.color.set(0xffffff);
                    mesh = new THREE.InstancedMesh(sphereGeo, sphereMat, validCount);
                    if (typeof mesh.setColorAt !== 'function') {
                        throw new Error('InstancedMesh.setColorAt not available');
                    }
                    if (mesh.instanceMatrix && mesh.instanceMatrix.setUsage) {
                        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                    }
                    const matrix = new THREE.Matrix4();
                    const color = new THREE.Color();
                    for (let i = 0; i < validCount; i++) {
                        const base = i * 3;
                        matrix.makeTranslation(
                            positions[base],
                            positions[base + 1],
                            positions[base + 2]
                        );
                        mesh.setMatrixAt(i, matrix);
                        if (mesh.setColorAt) {
                            color.setRGB(colorsArr[base], colorsArr[base + 1], colorsArr[base + 2]);
                            mesh.setColorAt(i, color);
                        }
                    }
                    mesh.instanceMatrix.needsUpdate = true;
                    if (!mesh.instanceColor) {
                        throw new Error('InstancedMesh instanceColor not available');
                    }
                    if (mesh.instanceColor) {
                        if (mesh.instanceColor.setUsage) {
                            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
                        }
                        if (mesh.geometry && mesh.geometry.setAttribute) {
                            mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);
                        }
                        mesh.instanceColor.needsUpdate = true;
                    }
                    if (debug) {
                        const hasAttr = !!(mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.instanceColor);
                        const instSample = mesh.instanceColor && mesh.instanceColor.array
                            ? Array.from(mesh.instanceColor.array.slice(0, Math.min(9, mesh.instanceColor.array.length)))
                            : [];
                        const instNonZero = instSample.filter(v => v > 0).length;
                        console.log(
                            'babia-points debug: instanced ready',
                            'instanceColor', !!mesh.instanceColor,
                            'instanceColorAttr', hasAttr,
                            'instanceColorSample', JSON.stringify(instSample),
                            'nonZero', instNonZero
                        );
                    }
                    if (mesh.computeBoundingSphere) {
                        mesh.computeBoundingSphere();
                    }
                } catch (err) {
                    console.warn('babia-points: instanced spheres failed, falling back to non-instanced', err);
                    mesh = null;
                }
            }
            if (mesh) {
                this.pointsObj = mesh;
            } else {
                const sphereGeo = new THREE.SphereGeometry(radius, segments, segments);
                const group = new THREE.Group();
                const meshes = new Array(validCount);
                for (let i = 0; i < validCount; i++) {
                    const base = i * 3;
                    const sphereMat = new THREE.MeshBasicMaterial({
                        color: new THREE.Color(colorsArr[base], colorsArr[base + 1], colorsArr[base + 2]),
                        transparent: data.opacity < 1,
                        opacity: data.opacity
                    });
                    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
                    sphereMesh.raycast = function () { };
                    sphereMesh.position.set(positions[base], positions[base + 1], positions[base + 2]);
                    group.add(sphereMesh);
                    meshes[i] = sphereMesh;
                }
                group.userData.meshes = meshes;

                const pickGeometry = geometry.clone();
                const pickMaterial = new THREE.PointsMaterial({
                    size: Math.max(0.0001, data.size),
                    transparent: true,
                    opacity: 0
                });
                pickMaterial.depthWrite = false;
                pickMaterial.colorWrite = false;
                const pickPoints = new THREE.Points(pickGeometry, pickMaterial);
                pickPoints.userData.babiaPoints = this;
                pickPoints.userData.validIndexMap = validIndexMap;
                pickPoints.userData.fields = { xKey, yKey, zKey, cKey };
                group.add(pickPoints);
                group.raycast = function (raycaster, intersects) {
                    pickPoints.raycast(raycaster, intersects);
                };
                this.raycastObj = pickPoints;
                this.pointsObj = group;
            }
        } else {
            const material = new THREE.PointsMaterial({
                size: data.size,
                vertexColors: true,
                transparent: data.opacity < 1,
                opacity: data.opacity,
                sizeAttenuation: true
            });
            this.pointsObj = new THREE.Points(geometry, material);
        }
        this.pointsObj.userData.babiaPoints = this;
        this.pointsObj.userData.validIndexMap = validIndexMap;
        this.pointsObj.userData.fields = { xKey, yKey, zKey, cKey };
        if (this.pointsObj.isGroup && this.pointsObj.userData && this.pointsObj.userData.meshes) {
            const meshes = this.pointsObj.userData.meshes;
            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];
                if (!mesh) {
                    continue;
                }
                mesh.userData.babiaPoints = this;
                mesh.userData.validIndexMap = validIndexMap;
                mesh.userData.babiaPointIndex = i;
                mesh.userData.fields = { xKey, yKey, zKey, cKey };
            }
        }
        this.el.classList.add('babia-points-target');
        this.el.setObject3D('mesh', this.pointsObj);
        this.el.emit('babia-points-updated', { count: validCount });
        this.refreshRaycasters();
    },

    setHighlight: function (index, colorHex) {
        if (!this.pointsObj) {
            return;
        }
        const isInstanced = this.pointsObj.isInstancedMesh;
        const isGroup = this.pointsObj.isGroup && this.pointsObj.userData && this.pointsObj.userData.meshes;
        if (!this.baseColors) {
            return;
        }
        const prevIndex = this.highlightIndex;
        if (prevIndex !== null && prevIndex !== index) {
            const prev = prevIndex * 3;
            if (prev + 2 < this.baseColors.length) {
                const prevColor = new THREE.Color(
                    this.baseColors[prev],
                    this.baseColors[prev + 1],
                    this.baseColors[prev + 2]
                );
                if (isInstanced && this.pointsObj.setColorAt) {
                    this.pointsObj.setColorAt(prevIndex, prevColor);
                    if (this.pointsObj.instanceColor) {
                        this.pointsObj.instanceColor.needsUpdate = true;
                    }
                } else if (this.pointsObj.geometry && this.pointsObj.geometry.attributes.color) {
                    const colors = this.pointsObj.geometry.attributes.color.array;
                    colors[prev] = this.baseColors[prev];
                    colors[prev + 1] = this.baseColors[prev + 1];
                    colors[prev + 2] = this.baseColors[prev + 2];
                    this.pointsObj.geometry.attributes.color.needsUpdate = true;
                } else if (isGroup) {
                    const meshes = this.pointsObj.userData.meshes;
                    const prevMesh = meshes && meshes[prevIndex];
                    if (prevMesh && prevMesh.material) {
                        prevMesh.material.color.copy(prevColor);
                        prevMesh.material.needsUpdate = true;
                    }
                }
            }
        }
        const color = new THREE.Color(colorHex || '#ffcc00');
        if (isInstanced && this.pointsObj.setColorAt) {
            this.pointsObj.setColorAt(index, color);
            if (this.pointsObj.instanceColor) {
                this.pointsObj.instanceColor.needsUpdate = true;
            }
        } else if (this.pointsObj.geometry && this.pointsObj.geometry.attributes.color) {
            const colors = this.pointsObj.geometry.attributes.color.array;
            const i = index * 3;
            if (i + 2 < colors.length) {
                colors[i] = color.r;
                colors[i + 1] = color.g;
                colors[i + 2] = color.b;
                this.pointsObj.geometry.attributes.color.needsUpdate = true;
            }
        } else if (isGroup) {
            const meshes = this.pointsObj.userData.meshes;
            const mesh = meshes && meshes[index];
            if (mesh && mesh.material) {
                mesh.material.color.copy(color);
                mesh.material.needsUpdate = true;
            }
        }
        this.highlightIndex = index;
    },

    clearHighlight: function () {
        if (!this.pointsObj) {
            return;
        }
        if (!this.baseColors || this.highlightIndex === null) {
            return;
        }
        const isGroup = this.pointsObj.isGroup && this.pointsObj.userData && this.pointsObj.userData.meshes;
        const i = this.highlightIndex * 3;
        if (i + 2 >= this.baseColors.length) {
            this.highlightIndex = null;
            return;
        }
        const color = new THREE.Color(
            this.baseColors[i],
            this.baseColors[i + 1],
            this.baseColors[i + 2]
        );
        if (this.pointsObj.isInstancedMesh && this.pointsObj.setColorAt) {
            this.pointsObj.setColorAt(this.highlightIndex, color);
            if (this.pointsObj.instanceColor) {
                this.pointsObj.instanceColor.needsUpdate = true;
            }
        } else if (this.pointsObj.geometry && this.pointsObj.geometry.attributes.color) {
            const colors = this.pointsObj.geometry.attributes.color.array;
            colors[i] = this.baseColors[i];
            colors[i + 1] = this.baseColors[i + 1];
            colors[i + 2] = this.baseColors[i + 2];
            this.pointsObj.geometry.attributes.color.needsUpdate = true;
        } else if (isGroup) {
            const meshes = this.pointsObj.userData.meshes;
            const mesh = meshes && meshes[this.highlightIndex];
            if (mesh && mesh.material) {
                mesh.material.color.copy(color);
                mesh.material.needsUpdate = true;
            }
        }
        this.highlightIndex = null;
    }
});

AFRAME.registerComponent('babia-points-tooltip', {
    schema: {
        target: { type: 'selector' },
        fields: { type: 'string' },
        width: { type: 'number', default: 1.6 },
        height: { type: 'number', default: 0.8 },
        textWidth: { type: 'number', default: 3 },
        textScale: { type: 'number', default: 1 },
        panelPointWidth: { type: 'number', default: 0 },
        panelPointHeight: { type: 'number', default: 0 },
        panelPointTextWidth: { type: 'number', default: 0 },
        panelPointTextScale: { type: 'number', default: 0 },
        panelCameraWidth: { type: 'number', default: 0 },
        panelCameraHeight: { type: 'number', default: 0 },
        panelCameraTextWidth: { type: 'number', default: 0 },
        panelCameraTextScale: { type: 'number', default: 0 },
        textAlign: { type: 'string', default: 'left' },
        textBaseline: { type: 'string', default: 'center' },
        textZOffset: { type: 'number', default: 0.001 },
        threshold: { type: 'number', default: 0.1 },
        fixedPosition: { type: 'vec3', default: { x: 0, y: 0.7, z: -1.2 } },
        fixedRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
        screenParent: { type: 'string', default: 'camera' }, // camera | entity | scene
        positionMode: { type: 'string', default: 'fixed' }, // fixed | hit
        hitOffset: { type: 'vec3', default: { x: 0, y: 0.15, z: 0 } },
        faceCamera: { type: 'boolean', default: true },
        highlight: { type: 'boolean', default: false },
        highlightColor: { type: 'color', default: '#ffd54f' },
        precision: { type: 'number', default: 3 },
        focusMode: { type: 'string', default: 'none' }, // none | clone
        focusDistance: { type: 'number', default: 0.45 },
        focusOffset: { type: 'vec3', default: { x: 0, y: -0.02, z: 0 } },
        focusSize: { type: 'number', default: 0.02 },
        focusLine: { type: 'boolean', default: true },
        focusLineColor: { type: 'color', default: '#9e9e9e' },
        focusLineOpacity: { type: 'number', default: 0.5 },
        focusFollow: { type: 'boolean', default: true },
        focusPanelParent: { type: 'string', default: 'camera' }, // camera | scene
        focusUpdateInterval: { type: 'number', default: 50 },
        panelMode: { type: 'string', default: 'point' }, // point | camera
        panelCameraPos: { type: 'vec3', default: { x: -0.35, y: 0.25, z: -0.9 } }
    },

    init: function () {
        this.tooltipEl = document.createElement('a-plane');
        this.tooltipEl.classList.add('babia-points-tooltip');
        this.tooltipEl.setAttribute('color', '#ffffff');
        this.tooltipEl.setAttribute('material', 'side: double; depthTest: false; depthWrite: false;');
        this.tooltipEl.setAttribute('opacity', '0.95');
        this.tooltipEl.setAttribute('visible', false);
        this._panelParentLocked = false;
        this._lastPanelMode = null;
        this._lastCameraPanelUpdate = 0;
        this.lastBabia = null;
        this._hadHit = false;
        this._lastIndex = null;
        this._panelParent = null;
        this._tmpVec = new THREE.Vector3();
        this._tmpCam = new THREE.Vector3();
        this._focusWorld = new THREE.Vector3();
        this._focusPanelWorld = new THREE.Vector3();
        this._focusHit = null;
        this._focusActive = false;
        this._focusDir = new THREE.Vector3();
        this._focusOffsetVec = new THREE.Vector3();
        this._focusHitOffset = new THREE.Vector3();
        this._focusCamPos = new THREE.Vector3();
        this._focusQuat = new THREE.Quaternion();
        this.focusEl = null;
        this.focusPointEl = null;
        this.focusLineEl = null;
        this._focusLineGeom = null;
        this._focusLineMat = null;
        this._focusLineObj = null;
        this._lastFocusUpdate = 0;
        this._onObject3DSet = this._onObject3DSet.bind(this);

        this.onIntersect = this.onIntersect.bind(this);
        this.onClear = this.onClear.bind(this);
        this.attachPanel = this.attachPanel.bind(this);

        this.el.addEventListener('raycaster-intersection', this.onIntersect);
        this.el.addEventListener('raycaster-intersection-cleared', this.onClear);
        this.tooltipEl.addEventListener('object3dset', this._onObject3DSet);
        if (this.el.sceneEl) {
            this.el.sceneEl.addEventListener('camera-set-active', this.attachPanel);
        }
        if (this.el.components.raycaster && this.el.components.raycaster.raycaster) {
            this.el.components.raycaster.raycaster.params.Points.threshold = this.data.threshold;
        }

        this.updatePanel();
        this.attachPanel();
        this._ensureFocusEntities();
    },

    update: function () {
        this.updatePanel();
        const mode = this._getPanelMode();
        if (mode !== this._lastPanelMode) {
            this._panelParentLocked = false;
            this._lastPanelMode = mode;
        }
        this.attachPanel();
        if (this.el.components.raycaster && this.el.components.raycaster.raycaster) {
            this.el.components.raycaster.raycaster.params.Points.threshold = this.data.threshold;
        }
        this._ensureFocusEntities();
        this._updateFocusStyle();
    },

    tick: function () {
        const rc = this.el.components.raycaster;
        if (!rc) {
            return;
        }
        const intersections = rc.intersections || [];
        if (intersections.length) {
            this.onIntersect({ detail: { intersections } });
            this._hadHit = true;
        } else if (this._hadHit) {
            this.onClear();
            this._hadHit = false;
        }
        if (this.tooltipEl && this.data.faceCamera && this.tooltipEl.getAttribute('visible')) {
            this._faceCamera();
        }
        if (this._focusActive && this._isFocusEnabled() && this.data.focusFollow) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const interval = Number(this.data.focusUpdateInterval) || 0;
            if (interval <= 0 || now - this._lastFocusUpdate >= interval) {
                this._lastFocusUpdate = now;
                this._updateFocusPosition();
            }
        }
        if (this.tooltipEl && this._isCameraPanelMode() && this.tooltipEl.getAttribute('visible')) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const interval = Number(this.data.focusUpdateInterval) || 0;
            if (interval <= 0 || now - this._lastCameraPanelUpdate >= interval) {
                this._lastCameraPanelUpdate = now;
                this._setTooltipCameraPosition();
            }
        }
    },

    remove: function () {
        this.el.removeEventListener('raycaster-intersection', this.onIntersect);
        this.el.removeEventListener('raycaster-intersection-cleared', this.onClear);
        if (this.el.sceneEl) {
            this.el.sceneEl.removeEventListener('camera-set-active', this.attachPanel);
        }
        if (this.tooltipEl) {
            this.tooltipEl.removeEventListener('object3dset', this._onObject3DSet);
        }
        if (this.tooltipEl && this.tooltipEl.parentNode) {
            this.tooltipEl.parentNode.removeChild(this.tooltipEl);
        }
        this.tooltipEl = null;
        if (this.focusEl && this.focusEl.parentNode) {
            this.focusEl.parentNode.removeChild(this.focusEl);
        }
        if (this.focusLineEl && this.focusLineEl.parentNode) {
            this.focusLineEl.parentNode.removeChild(this.focusLineEl);
        }
        this.focusEl = null;
        this.focusPointEl = null;
        this.focusLineEl = null;
        if (this._focusLineGeom) {
            this._focusLineGeom.dispose();
        }
        if (this._focusLineMat) {
            this._focusLineMat.dispose();
        }
        this._focusLineGeom = null;
        this._focusLineMat = null;
        this._focusLineObj = null;
        if (this.lastBabia && this.lastBabia.clearHighlight) {
            this.lastBabia.clearHighlight();
        }
        this.lastBabia = null;
    },

    attachPanel: function () {
        if (!this.tooltipEl) {
            return;
        }
        if (this._panelParentLocked && this.tooltipEl.parentNode) {
            return;
        }
        const scene = this.el.sceneEl;
        const cameraEl = scene && scene.camera && scene.camera.el ? scene.camera.el : null;
        let parent = this.el;
        const effectiveParent = this._getEffectiveScreenParent();
        if (effectiveParent === 'camera' && cameraEl) {
            parent = cameraEl;
        } else if (effectiveParent === 'scene' && scene) {
            parent = scene;
        }
        if (this.tooltipEl.parentNode !== parent) {
            if (this.tooltipEl.parentNode) {
                this.tooltipEl.parentNode.removeChild(this.tooltipEl);
            }
            parent.appendChild(this.tooltipEl);
        }
        this._panelParent = parent;
        if (this.tooltipEl.object3D) {
            this.tooltipEl.object3D.renderOrder = 999;
        }
        this._panelParentLocked = true;
    },

    updatePanel: function () {
        if (!this.tooltipEl) {
            return;
        }
        const positionMode = this._getEffectivePositionMode();
        const fixedPos = this._getEffectiveFixedPosition();
        const panelWidth = this._getEffectiveMetric(
            this.data.panelPointWidth,
            this.data.panelCameraWidth,
            this.data.width
        );
        const panelHeight = this._getEffectiveMetric(
            this.data.panelPointHeight,
            this.data.panelCameraHeight,
            this.data.height
        );
        const panelTextWidth = this._getEffectiveMetric(
            this.data.panelPointTextWidth,
            this.data.panelCameraTextWidth,
            this.data.textWidth
        );
        const panelTextScale = this._getEffectiveMetric(
            this.data.panelPointTextScale,
            this.data.panelCameraTextScale,
            this.data.textScale
        );
        this.tooltipEl.setAttribute('width', panelWidth);
        this.tooltipEl.setAttribute('height', panelHeight);
        this.tooltipEl.setAttribute('material', 'side: double; depthTest: false; depthWrite: false;');
        this.tooltipEl.setAttribute('text', {
            value: '',
            color: '#111111',
            align: this.data.textAlign,
            baseline: this.data.textBaseline,
            width: panelTextWidth,
            wrapCount: 32,
            zOffset: this.data.textZOffset
        });
        this.tooltipEl.setAttribute('scale', {
            x: panelTextScale,
            y: panelTextScale,
            z: panelTextScale
        });
        if (positionMode === 'fixed' && !this._isCameraPanelMode()) {
            this.tooltipEl.setAttribute('position', fixedPos);
        }
        this.tooltipEl.setAttribute('rotation', this.data.fixedRotation);
        if (this.data.faceCamera) {
            this.tooltipEl.setAttribute('babia-lookat', '[camera]');
        }
    },

    _isFocusEnabled: function () {
        if (this._getPanelMode() !== 'focus') {
            return false;
        }
        return (this.data.focusMode || '').toLowerCase() === 'clone';
    },

    _getPanelMode: function () {
        return (this.data.panelMode || 'point').toLowerCase();
    },

    _isCameraPanelMode: function () {
        return this._getPanelMode() === 'camera';
    },

    _getEffectiveScreenParent: function () {
        const mode = this._getPanelMode();
        if (mode === 'camera') {
            return 'scene';
        }
        if (mode === 'point') {
            return 'scene';
        }
        return (this.data.screenParent || 'scene').toLowerCase();
    },

    _getEffectivePositionMode: function () {
        const mode = this._getPanelMode();
        if (mode === 'camera') {
            return 'fixed';
        }
        if (mode === 'point') {
            return 'hit';
        }
        return (this.data.positionMode || 'fixed').toLowerCase();
    },

    _getEffectiveFixedPosition: function () {
        const mode = this._getPanelMode();
        if (mode === 'camera') {
            return this.data.panelCameraPos || this.data.fixedPosition;
        }
        return this.data.fixedPosition;
    },

    _getEffectiveMetric: function (pointValue, cameraValue, fallback) {
        const mode = this._getPanelMode();
        if (mode === 'point' && typeof pointValue === 'number' && pointValue > 0) {
            return pointValue;
        }
        if (mode === 'camera' && typeof cameraValue === 'number' && cameraValue > 0) {
            return cameraValue;
        }
        return fallback;
    },

    _setTooltipCameraPosition: function () {
        if (!this.tooltipEl) {
            return;
        }
        const scene = this.el.sceneEl;
        const cameraObj = scene && scene.camera && scene.camera.el && scene.camera.el.object3D;
        if (!cameraObj) {
            return;
        }
        const local = this._tmpVec;
        const camPos = this._focusCamPos;
        const camQuat = this._focusQuat;
        const panelPos = this.data.panelCameraPos || this.data.fixedPosition || { x: 0, y: 0, z: -1 };
        local.set(panelPos.x, panelPos.y, panelPos.z);
        cameraObj.getWorldQuaternion(camQuat);
        local.applyQuaternion(camQuat);
        cameraObj.getWorldPosition(camPos);
        local.add(camPos);
        this._setTooltipWorldPosition(local);
    },

    _ensureFocusEntities: function () {
        if (!this._isFocusEnabled()) {
            this._hideFocus();
            return;
        }
        if (this.focusEl || !this.el.sceneEl) {
            return;
        }
        const scene = this.el.sceneEl;
        this.focusEl = document.createElement('a-entity');
        this.focusEl.setAttribute('visible', false);
        this.focusEl.classList.add('babia-focus-point');

        this.focusPointEl = document.createElement('a-sphere');
        this.focusPointEl.setAttribute('radius', this.data.focusSize);
        this.focusPointEl.setAttribute('segments-width', 8);
        this.focusPointEl.setAttribute('segments-height', 8);
        this.focusPointEl.setAttribute('material', 'shader: flat; color: #ffffff; depthTest: false; depthWrite: false;');
        this.focusEl.appendChild(this.focusPointEl);

        scene.appendChild(this.focusEl);

        this.focusLineEl = document.createElement('a-entity');
        this.focusLineEl.setAttribute('visible', false);
        this._focusLineGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(6);
        this._focusLineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this._focusLineMat = new THREE.LineBasicMaterial({
            color: new THREE.Color(this.data.focusLineColor),
            transparent: true,
            opacity: this.data.focusLineOpacity,
            depthTest: false,
            depthWrite: false
        });
        this._focusLineObj = new THREE.Line(this._focusLineGeom, this._focusLineMat);
        this.focusLineEl.setObject3D('mesh', this._focusLineObj);
        scene.appendChild(this.focusLineEl);
    },

    _updateFocusStyle: function () {
        if (!this._isFocusEnabled() || !this.focusPointEl) {
            return;
        }
        this.focusPointEl.setAttribute('radius', this.data.focusSize);
        if (this._focusLineMat) {
            this._focusLineMat.color = new THREE.Color(this.data.focusLineColor);
            this._focusLineMat.opacity = this.data.focusLineOpacity;
            this._focusLineMat.transparent = true;
            this._focusLineMat.depthTest = false;
            this._focusLineMat.depthWrite = false;
            this._focusLineMat.needsUpdate = true;
        }
    },

    _hideFocus: function () {
        this._focusActive = false;
        this._focusHit = null;
        if (this.focusEl) {
            this.focusEl.setAttribute('visible', false);
        }
        if (this.focusLineEl) {
            this.focusLineEl.setAttribute('visible', false);
        }
        if (this._focusLineObj) {
            this._focusLineObj.visible = false;
        }
    },

    _setTooltipWorldPosition: function (worldPos, offset) {
        if (!this.tooltipEl || !worldPos) {
            return;
        }
        const pos = this._tmpVec;
        pos.copy(worldPos);
        if (offset) {
            pos.x += offset.x;
            pos.y += offset.y;
            pos.z += offset.z;
        }
        const parent = this._panelParent || this.tooltipEl.parentNode;
        if (parent && parent.object3D) {
            const local = pos.clone();
            parent.object3D.worldToLocal(local);
            this.tooltipEl.setAttribute('position', { x: local.x, y: local.y, z: local.z });
        } else {
            this.tooltipEl.setAttribute('position', { x: pos.x, y: pos.y, z: pos.z });
        }
    },

    _getPointColorHex: function (babia, index) {
        if (babia && babia.baseColors) {
            const base = index * 3;
            if (base + 2 < babia.baseColors.length) {
                const c = new THREE.Color(
                    babia.baseColors[base],
                    babia.baseColors[base + 1],
                    babia.baseColors[base + 2]
                );
                return '#' + c.getHexString();
            }
        }
        return this.data.highlightColor || '#ffd54f';
    },

    _updateFocusPosition: function () {
        if (!this._focusActive || !this._focusHit || !this.focusEl) {
            return;
        }
        const scene = this.el.sceneEl;
        const cameraObj = scene && scene.camera && scene.camera.el && scene.camera.el.object3D;
        if (!cameraObj) {
            return;
        }
        cameraObj.getWorldPosition(this._focusCamPos);
        cameraObj.getWorldDirection(this._focusDir);
        this._focusDir.normalize();
        this._focusWorld.copy(this._focusCamPos).addScaledVector(this._focusDir, this.data.focusDistance);
        this._focusOffsetVec.set(this.data.focusOffset.x, this.data.focusOffset.y, this.data.focusOffset.z);
        cameraObj.getWorldQuaternion(this._focusQuat);
        this._focusOffsetVec.applyQuaternion(this._focusQuat);
        this._focusWorld.add(this._focusOffsetVec);

        this.focusEl.setAttribute('position', {
            x: this._focusWorld.x,
            y: this._focusWorld.y,
            z: this._focusWorld.z
        });
        this.focusEl.setAttribute('visible', true);

        if (this.focusLineEl && this.data.focusLine && this._focusHit.point && this._focusLineGeom) {
            const p = this._focusHit.point;
            const posAttr = this._focusLineGeom.getAttribute('position');
            posAttr.setXYZ(0, p.x, p.y, p.z);
            posAttr.setXYZ(1, this._focusWorld.x, this._focusWorld.y, this._focusWorld.z);
            posAttr.needsUpdate = true;
            this._focusLineGeom.computeBoundingSphere();
            this.focusLineEl.setAttribute('visible', true);
            if (this._focusLineObj) {
                this._focusLineObj.visible = true;
            }
        }

        const hitOffset = this.data.hitOffset || { x: 0, y: 0, z: 0 };
        const focusPanelParent = (this.data.focusPanelParent || '').toLowerCase();
        if (focusPanelParent === 'camera') {
            this.tooltipEl.setAttribute('position', {
                x: this.data.focusOffset.x + hitOffset.x,
                y: this.data.focusOffset.y + hitOffset.y,
                z: -this.data.focusDistance + hitOffset.z
            });
        } else {
            this._focusHitOffset.set(hitOffset.x, hitOffset.y, hitOffset.z);
            this._focusHitOffset.applyQuaternion(this._focusQuat);
            this._focusPanelWorld.copy(this._focusWorld).add(this._focusHitOffset);
            this._setTooltipWorldPosition(this._focusPanelWorld);
        }
    },

    _onObject3DSet: function (evt) {
        if (!evt || evt.detail.type !== 'text' || !this.tooltipEl) {
            return;
        }
        const textMesh = this.tooltipEl.getObject3D('text');
        if (textMesh) {
            textMesh.renderOrder = 1001;
            if (textMesh.material) {
                textMesh.material.depthTest = false;
                textMesh.material.depthWrite = false;
                textMesh.material.transparent = true;
                textMesh.material.side = THREE.DoubleSide;
                textMesh.material.needsUpdate = true;
            }
        }
    },

    _faceCamera: function () {
        const scene = this.el.sceneEl;
        const cameraObj = scene && scene.camera && scene.camera.el && scene.camera.el.object3D;
        if (!cameraObj || !this.tooltipEl || !this.tooltipEl.object3D) {
            return;
        }
        cameraObj.getWorldPosition(this._tmpCam);
        this.tooltipEl.object3D.lookAt(this._tmpCam);
    },

    onClear: function () {
        if (this.tooltipEl) {
            this.tooltipEl.setAttribute('visible', false);
        }
        this._hideFocus();
        if (this.lastBabia && this.lastBabia.clearHighlight) {
            this.lastBabia.clearHighlight();
        }
        this.lastBabia = null;
        this._lastIndex = null;
    },

    onIntersect: function (evt) {
        const intersections = (evt.detail && evt.detail.intersections) ||
            (this.el.components.raycaster && this.el.components.raycaster.intersections) || [];
        if (!intersections.length) {
            return;
        }
        const hit = intersections[0];
        const obj = hit.object;
        let babia = obj && obj.userData ? obj.userData.babiaPoints : null;
        if (!babia && hit.el && hit.el.components && hit.el.components['babia-points']) {
            babia = hit.el.components['babia-points'];
        }
        if (!babia) {
            return;
        }
        if (this.data.target && babia.el && babia.el !== this.data.target) {
            return;
        }

        let index = hit.index;
        if (hit.instanceId !== undefined && hit.instanceId !== null) {
            index = hit.instanceId;
        } else if (obj.userData.babiaPointIndex !== undefined && obj.userData.babiaPointIndex !== null) {
            index = obj.userData.babiaPointIndex;
        }
        const map = (obj && obj.userData && obj.userData.validIndexMap) ||
            (babia.pointsObj && babia.pointsObj.userData && babia.pointsObj.userData.validIndexMap) || [];
        if (index === undefined || index === null || map[index] === undefined) {
            return;
        }
        if (this.lastBabia === babia && this._lastIndex === index && this.tooltipEl) {
            this.tooltipEl.setAttribute('visible', true);
            if (this._isFocusEnabled() && hit.point) {
                this._ensureFocusEntities();
                this._focusActive = true;
                this._focusHit = { point: hit.point.clone(), babia, index };
                if (this.focusPointEl) {
                    this.focusPointEl.setAttribute('color', this._getPointColorHex(babia, index));
                }
                this.attachPanel();
            }
            return;
        }
        const row = babia.newData[map[index]];
        const activeFields = (obj && obj.userData && obj.userData.fields) ||
            (babia.pointsObj && babia.pointsObj.userData && babia.pointsObj.userData.fields) || null;
        const fallbackFields = activeFields
            ? [activeFields.xKey, activeFields.yKey, activeFields.zKey, activeFields.cKey]
            : [babia.data.x, babia.data.y, babia.data.z, babia.data.color];
        const keys = this.data.fields
            ? this.data.fields.split(',').map(s => s.trim()).filter(Boolean)
            : fallbackFields.filter(Boolean);

        let text = '';
        const precision = (typeof this.data.precision === 'number') ? this.data.precision : 3;
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            let val = row[k];
            if (typeof val === 'number' && isFinite(val)) {
                val = val.toFixed(precision);
            }
            text += k + ': ' + val + (i === keys.length - 1 ? '' : '\n');
        }

        this.tooltipEl.setAttribute('text', 'value', text);
        this.tooltipEl.setAttribute('visible', true);

        if (this._isFocusEnabled() && hit.point) {
            this._ensureFocusEntities();
            this._focusActive = true;
            this._focusHit = { point: hit.point.clone(), babia, index };
            if (this.focusPointEl) {
                this.focusPointEl.setAttribute('color', this._getPointColorHex(babia, index));
            }
            this.attachPanel();
            this._updateFocusPosition();
        } else {
            this.attachPanel();
            const positionMode = this._getEffectivePositionMode();
            if (positionMode === 'hit' && hit.point) {
                this._setTooltipWorldPosition(hit.point, this.data.hitOffset);
            } else if (positionMode === 'fixed' && this._isCameraPanelMode()) {
                this._setTooltipCameraPosition();
            } else if (positionMode === 'fixed') {
                this.tooltipEl.setAttribute('position', this._getEffectiveFixedPosition());
            }
        }

        if (this.data.highlight && babia && babia.setHighlight) {
            if (this.lastBabia && this.lastBabia !== babia && this.lastBabia.clearHighlight) {
                this.lastBabia.clearHighlight();
            }
            babia.setHighlight(index, this.data.highlightColor);
            this.lastBabia = babia;
        }
        this._lastIndex = index;
    }
});
