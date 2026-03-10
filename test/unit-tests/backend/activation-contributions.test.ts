import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { Parser } from '@cmt/contextKeyExpr';

/**
 * Guards the two-phase activation reveal that makes the CMake activity-bar sidebar
 * appear immediately with an "initializing" placeholder instead of staying hidden
 * until the (potentially slow) backend initialization completes.
 *
 * The safety contract this test pins:
 *  - the activity-bar container is revealed by EITHER `cmake:isInitializing` OR the
 *    existing readiness key `cmake:enableFullFeatureSet`;
 *  - ONLY the transient `cmake.initializing` view is gated on `cmake:isInitializing`,
 *    and only while the backend is not yet ready
 *    (`cmake:isInitializing && !cmake:enableFullFeatureSet`);
 *  - the real views remain gated exclusively on `cmake:enableFullFeatureSet`;
 *  - `cmake:isInitializing` never leaks into any command/menu/keybinding, so no
 *    project functionality can run against a partially-initialized backend.
 *
 * It reads `package.json` from disk (walking up from `__dirname`) so it works under
 * both `yarn backendTests` and `yarn unitTests`.
 */
function findExtensionManifest(): any {
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate)) {
            const json = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            if (json?.contributes?.languages?.some((l: { id?: string }) => l.id === 'cmake')) {
                return json;
            }
        }
        dir = path.dirname(dir);
    }
    throw new Error('CMake Tools package.json (with a `cmake` language contribution) was not found');
}

const INITIALIZING_KEY = 'cmake:isInitializing';
const FULL_FEATURE_KEY = 'cmake:enableFullFeatureSet';
const CONTAINER_WHEN = 'cmake:isInitializing || cmake:enableFullFeatureSet';
const TRANSIENT_WHEN = 'cmake:isInitializing && !cmake:enableFullFeatureSet';

/** Evaluate a when-clause string against a boolean context using the real parser. */
function evaluateWhen(clause: string, ctx: Record<string, boolean>): boolean {
    const expr = new Parser().parse(clause);
    expect(expr, `when clause "${clause}" should parse`).to.not.be.undefined;
    return expr!.evaluate({ getValue: <T>(key: string): T | undefined => ctx[key] as unknown as T });
}

suite('[activation-contributions] two-phase sidebar reveal', () => {
    let contributes: any;
    suiteSetup(() => {
        contributes = findExtensionManifest().contributes;
    });

    test('activity-bar container is revealed by either the initializing or the full-feature key', () => {
        const container = contributes.viewsContainers.activitybar.find((c: { id: string }) => c.id === 'cmake-view');
        expect(container, 'cmake-view container').to.be.an('object');
        expect(container.when).to.equal(CONTAINER_WHEN);
    });

    test('the transient cmake.initializing view exists and is gated only while initializing and not yet ready', () => {
        const views = contributes.views['cmake-view'];
        const initializingView = views.find((v: { id: string }) => v.id === 'cmake.initializing');
        expect(initializingView, 'cmake.initializing view').to.be.an('object');
        expect(initializingView.when).to.equal(TRANSIENT_WHEN);
    });

    test('a viewsWelcome entry backs the transient view with the same gate', () => {
        const welcome = contributes.viewsWelcome.find((w: { view: string }) => w.view === 'cmake.initializing');
        expect(welcome, 'cmake.initializing viewsWelcome').to.be.an('object');
        expect(welcome.when).to.equal(TRANSIENT_WHEN);
        expect(welcome.contents, 'welcome contents').to.be.a('string').and.have.length.greaterThan(0);
    });

    test('all real views remain gated exclusively on the full-feature key', () => {
        const views = contributes.views['cmake-view'];
        for (const id of ['cmake.projectStatus', 'cmake.outline', 'cmake.pinnedCommands', 'cmake.bookmarks']) {
            const view = views.find((v: { id: string }) => v.id === id);
            expect(view, `view ${id}`).to.be.an('object');
            expect(view.when, `view ${id} when`).to.equal(FULL_FEATURE_KEY);
        }
    });

    test('the initializing key never gates a command, menu, or keybinding (no functionality leaks into the initializing phase)', () => {
        for (const section of ['commands', 'keybindings'] as const) {
            const json = JSON.stringify(contributes[section] ?? []);
            expect(json, `contributes.${section} must not reference ${INITIALIZING_KEY}`).to.not.contain(INITIALIZING_KEY);
        }
        const menusJson = JSON.stringify(contributes.menus ?? {});
        expect(menusJson, `contributes.menus must not reference ${INITIALIZING_KEY}`).to.not.contain(INITIALIZING_KEY);
    });

    test('the container is visible exactly when it has an active child view', () => {
        // VS Code reveals a custom activity-bar container when it has at least one active
        // (visible) child view. That — not the container's own `when` — is the authoritative
        // mechanism, so this asserts container visibility as the union of its child-view gates.
        const containerVisibleViaChildren = (ctx: Record<string, boolean>) =>
            evaluateWhen(TRANSIENT_WHEN, ctx) || evaluateWhen(FULL_FEATURE_KEY, ctx);
        expect(containerVisibleViaChildren({ [INITIALIZING_KEY]: false, [FULL_FEATURE_KEY]: false }), 'hidden when neither').to.be.false;
        expect(containerVisibleViaChildren({ [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: false }), 'visible while initializing').to.be.true;
        expect(containerVisibleViaChildren({ [INITIALIZING_KEY]: false, [FULL_FEATURE_KEY]: true }), 'visible when ready').to.be.true;
        expect(containerVisibleViaChildren({ [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: true }), 'visible in handoff window').to.be.true;
        // The declared container `when` must never be MORE restrictive than the active child views
        // (so that, if honored, it can't hide a container that has a visible child).
        for (const ctx of [
            { [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: false },
            { [INITIALIZING_KEY]: false, [FULL_FEATURE_KEY]: true },
            { [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: true }
        ]) {
            expect(evaluateWhen(CONTAINER_WHEN, ctx), 'declared container gate agrees with active child views').to.equal(containerVisibleViaChildren(ctx));
        }
    });

    test('the transient view and the real views are never simultaneously visible', () => {
        // Transient view visible only during init, before readiness.
        expect(evaluateWhen(TRANSIENT_WHEN, { [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: false }), 'transient during init').to.be.true;
        // Once ready, the transient view hides immediately even though the initializing
        // key is only cleared later (in the activation finally block).
        expect(evaluateWhen(TRANSIENT_WHEN, { [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: true }), 'transient hidden once ready').to.be.false;
        // Real views (gated on the full key) are hidden during init and shown once ready.
        expect(evaluateWhen(FULL_FEATURE_KEY, { [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: false }), 'real views hidden during init').to.be.false;
        expect(evaluateWhen(FULL_FEATURE_KEY, { [INITIALIZING_KEY]: true, [FULL_FEATURE_KEY]: true }), 'real views shown once ready').to.be.true;
    });
});
