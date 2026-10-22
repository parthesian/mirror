import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

type FocusPose = { x: number; y: number };

type GlobeExplorerCtor = {
    prototype: {
        _rotateToLocation(location: { latitude: number; longitude: number }): void;
        _syncRotateToggleUI(): void;
    };
    focusRotation(lat: number, lon: number): FocusPose;
};

function loadGlobeExplorer(): GlobeExplorerCtor {
    const source = readFileSync(join(repoRoot, 'js/globeExplorer.js'), 'utf8');
    const windowStub: { GlobeExplorer?: GlobeExplorerCtor } = {};
    const runner = new Function(
        'window',
        'document',
        'console',
        `${source}\nreturn window.GlobeExplorer;`,
    ) as (
        window: { GlobeExplorer?: GlobeExplorerCtor },
        document: { getElementById(): null },
        console: Console,
    ) => GlobeExplorerCtor;
    return runner(windowStub, { getElementById: () => null }, console);
}

function latLonToVec3(lat: number, lon: number): Vector3 {
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((lon + 180) * Math.PI) / 180;
    return new Vector3(
        -Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
    );
}

function facingDot(group: Group, lat: number, lon: number, camera: PerspectiveCamera): number {
    const point = latLonToVec3(lat, lon).applyQuaternion(group.quaternion);
    return point.dot(camera.position.clone().normalize());
}

function installDomStub(): void {
    Object.assign(globalThis, {
        document: {
            addEventListener(): void {},
            removeEventListener(): void {},
        },
    });
}

describe('photo globe focus', () => {
    const GlobeExplorer = loadGlobeExplorer();

    it('puts the coordinate on the camera axis', () => {
        const places = [
            { lat: 64.1466, lon: -21.9426 },
            { lat: 35.6762, lon: 139.6503 },
            { lat: -33.9249, lon: 18.4241 },
            { lat: 36.2704, lon: -121.8081 },
            { lat: 0, lon: 0 },
        ];
        for (const place of places) {
            const pose = GlobeExplorer.focusRotation(place.lat, place.lon);
            expect(pose).toEqual({
                x: (place.lat * Math.PI) / 180,
                y: -Math.PI / 2 - (place.lon * Math.PI) / 180,
            });
            const group = new Group();
            group.rotation.x = pose.x;
            group.rotation.y = pose.y;
            const dot = latLonToVec3(place.lat, place.lon)
                .applyQuaternion(group.quaternion)
                .dot(new Vector3(0, 0, 1));
            expect(dot).toBeCloseTo(1, 6);
        }
    });

    it('faces the camera without an orbit update before the pose', () => {
        installDomStub();
        const camera = new PerspectiveCamera(45, 1, 0.1, 1000);
        camera.position.set(0, 0, 3.2);
        const element = {
            style: {},
            addEventListener(): void {},
            removeEventListener(): void {},
        };
        const controls = new OrbitControls(camera, element);
        controls.enableDamping = true;
        controls.dampingFactor = 0.16;
        controls.minPolarAngle = Math.PI / 2 - (62 * Math.PI) / 180;
        controls.maxPolarAngle = Math.PI / 2 + (62 * Math.PI) / 180;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.85;

        const group = new Group();
        group.rotation.y = -Math.PI / 2;
        for (let frame = 0; frame < 180; frame += 1) {
            controls.update();
        }
        camera.position.set(0.7, 1.1, 2.4).setLength(3.2);
        controls.update();
        expect(
            Math.abs(controls.getAzimuthalAngle()) > 0.05 ||
                Math.abs(controls.getPolarAngle() - Math.PI / 2) > 0.05,
        ).toBe(true);

        const place = { latitude: 35.6762, longitude: 139.6503 };
        const pose = GlobeExplorer.focusRotation(place.latitude, place.longitude);
        const updates: Array<{ rotX: number; rotY: number; up: number[] }> = [];
        const originalUpdate = controls.update.bind(controls);
        controls.update = () => {
            updates.push({
                rotX: group.rotation.x,
                rotY: group.rotation.y,
                up: camera.up.toArray(),
            });
            return originalUpdate();
        };
        const upSet = camera.up.set.bind(camera.up);
        const upWrites: number[][] = [];
        camera.up.set = (x: number, y: number, z: number) => {
            upWrites.push([x, y, z]);
            return upSet(x, y, z);
        };

        const explorer = Object.create(GlobeExplorer.prototype) as {
            autoRotateEnabled: boolean;
            lastManualRotateAt: number;
            rotateToggleBtn: null;
            threeState: {
                group: Group;
                controls: OrbitControls;
                camera: PerspectiveCamera;
                uprightSpin: boolean;
            };
            _rotateToLocation(location: { latitude: number; longitude: number }): void;
        };
        explorer.autoRotateEnabled = true;
        explorer.lastManualRotateAt = 0;
        explorer.rotateToggleBtn = null;
        explorer.threeState = {
            group,
            controls,
            camera,
            uprightSpin: true,
        };

        explorer._rotateToLocation(place);

        expect(updates.length).toBeGreaterThan(0);
        for (const update of updates) {
            expect(update.rotX).toBeCloseTo(pose.x, 8);
            expect(update.rotY).toBeCloseTo(pose.y, 8);
            expect(update.up).toEqual([0, 1, 0]);
        }
        expect(upWrites).toEqual([]);
        expect(camera.up.toArray()).toEqual([0, 1, 0]);
        expect(explorer.autoRotateEnabled).toBe(false);
        expect(controls.autoRotate).toBe(false);
        expect(explorer.threeState.uprightSpin).toBe(false);
        expect(facingDot(group, place.latitude, place.longitude, camera)).toBeCloseTo(1, 5);
        expect(controls.getAzimuthalAngle()).toBeCloseTo(0, 5);
        expect(controls.getPolarAngle()).toBeCloseTo(Math.PI / 2, 5);

        controls.update = originalUpdate;
        for (let frame = 0; frame < 40; frame += 1) {
            controls.update();
        }
        expect(facingDot(group, place.latitude, place.longitude, camera)).toBeCloseTo(1, 5);
        camera.position.multiplyScalar(4.5 / camera.position.length());
        controls.update();
        expect(facingDot(group, place.latitude, place.longitude, camera)).toBeCloseTo(1, 5);
    });

    it('keeps idle spin and still pauses when a drag starts', () => {
        const source = readFileSync(join(repoRoot, 'js/globeExplorer.js'), 'utf8');
        expect(source).toContain('controls.autoRotate = this.autoRotateEnabled');
        expect(source).toContain('controls.autoRotateSpeed = 0.85');
        const dragAt = source.indexOf("addEventListener('pointermove'");
        const drag = source.slice(dragAt, source.indexOf('pendingHoverPointer', dragAt));
        expect(drag).toContain('this.autoRotateEnabled = false');
        expect(drag).toContain('controls.autoRotate = false');
        expect(source).not.toContain('_levelCamera');
        expect(source).not.toContain('camera.up.set');
    });
});
