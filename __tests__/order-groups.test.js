import { SHOW_FINISHED_LABEL, assignmentOf, buildOrderList, claimFirstAvailable, countHiddenFinishedOrders, dismissMessage, dismissalKeysFor, findHeldSibling, getChildIndex, getReportKey, heldMessage, hiddenFinishedMessage, isFinishedOrder, listOpenSiblings, listShownHeldOrders } from '../src/utils/order-groups';

const REPORT = '8f14e45f-ceea-467a-9af6-1c0c3d0a1b11';
const OTHER_REPORT = '0b2a1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ME = 'driver_me';

// A stand-in for a Fleetbase SDK Order: getAttribute walks dotted paths like the SDK's lodash-style get, returns null for a missing path, and the optional `server` hooks script reload() and start().
const makeOrder = (id, attributes = {}, server = {}) => {
    const order = {
        id,
        attributes: { id, adhoc: true, driver_assigned: null, ...attributes },
        getAttribute(path, fallback = null) {
            const value = path.split('.').reduce((node, part) => (node === null || node === undefined ? undefined : node[part]), this.attributes);
            return value === undefined ? fallback : value;
        },
        reload: jest.fn(async () => (server.reload ? server.reload(order) : order)),
        start: jest.fn(async (params) => (server.start ? server.start(order, params) : order)),
    };
    return order;
};

const sibling = (id, childIndex, extra = {}) => makeOrder(id, { meta: { report_id: REPORT, child_index: childIndex }, ...extra });
const assignedTo = (driverId) => ({ id: driverId });
const ids = (orders) => orders.map((order) => order.id);

describe('getReportKey', () => {
    test('reads meta.report_id', () => {
        expect(getReportKey(makeOrder('o1', { meta: { report_id: REPORT } }))).toBe(REPORT);
    });

    test.each([['meta.reportId', { meta: { reportId: REPORT } }], ['meta.validation_id', { meta: { validation_id: REPORT } }], ['meta.validationId', { meta: { validationId: REPORT } }], ['custom_fields.validation_id', { custom_fields: { validation_id: REPORT } }]])('falls back to %s', (_name, attributes) => {
        expect(getReportKey(makeOrder('o1', attributes))).toBe(REPORT);
    });

    test('prefers meta.report_id over the older spellings', () => {
        expect(getReportKey(makeOrder('o1', { meta: { report_id: REPORT, validation_id: OTHER_REPORT } }))).toBe(REPORT);
    });

    test('trims and lowercases', () => {
        expect(getReportKey(makeOrder('o1', { meta: { report_id: `  ${REPORT.toUpperCase()} ` } }))).toBe(REPORT);
    });

    test.each([[{}], [{ meta: {} }], [{ meta: { report_id: '' } }], [{ meta: { report_id: '   ' } }], [{ meta: { report_id: 42 } }], [{ meta: null }]])('returns null for %j', (attributes) => {
        expect(getReportKey(makeOrder('o1', attributes))).toBeNull();
    });
});

describe('getChildIndex', () => {
    test('reads meta.child_index', () => {
        expect(getChildIndex(makeOrder('o1', { meta: { child_index: 2 } }))).toBe(2);
    });

    test('sorts a missing or invalid index last', () => {
        const last = getChildIndex(makeOrder('o1', {}));
        expect(last).toBeGreaterThan(3);
        expect(getChildIndex(makeOrder('o2', { meta: { child_index: 0 } }))).toBe(last);
        expect(getChildIndex(makeOrder('o3', { meta: { child_index: 'x' } }))).toBe(last);
    });
});

describe('buildOrderList', () => {
    test('collapses the unassigned siblings of a report into one card, lowest child index first', () => {
        const items = buildOrderList([sibling('o3', 3), sibling('o1', 1), sibling('o2', 2)], []);
        expect(items).toHaveLength(1);
        expect(items[0].key).toBe(`report:${REPORT}`);
        expect(items[0].order.id).toBe('o1');
        expect(ids(items[0].siblings)).toEqual(['o1', 'o2', 'o3']);
    });

    test('breaks a child index tie, and a missing index, by feed position', () => {
        const noIndex = makeOrder('oa', { meta: { report_id: REPORT } });
        const items = buildOrderList([noIndex, sibling('o2', 2)], []);
        expect(ids(items[0].siblings)).toEqual(['o2', 'oa']);
    });

    test('sorts a released sibling (started, unassigned) last, so it is never the displayed order while a free sibling exists', () => {
        const released = sibling('o1', 1, { started: true });
        const items = buildOrderList([released, sibling('o2', 2), sibling('o3', 3)], []);
        expect(items).toHaveLength(1);
        expect(items[0].order.id).toBe('o2');
        expect(ids(items[0].siblings)).toEqual(['o2', 'o3', 'o1']);
    });

    test('groups siblings that carry the report id under different spellings', () => {
        const old = makeOrder('o2', { meta: { validation_id: REPORT, child_index: 2 } });
        const items = buildOrderList([sibling('o1', 1), old], []);
        expect(items).toHaveLength(1);
        expect(ids(items[0].siblings)).toEqual(['o1', 'o2']);
    });

    test('shows one card per report', () => {
        const other = makeOrder('p1', { meta: { report_id: OTHER_REPORT, child_index: 1 } });
        const items = buildOrderList([sibling('o1', 1), other, sibling('o2', 2)], []);
        expect(items.map((item) => item.order.id)).toEqual(['o1', 'p1']);
    });

    test('hides the nearby siblings of a report the driver holds an order of', () => {
        const held = sibling('o1', 1, { driver_assigned: assignedTo(ME), status: 'completed' });
        const items = buildOrderList([sibling('o2', 2), sibling('o3', 3)], [held]);
        expect(items.map((item) => item.order.id)).toEqual(['o1']);
    });

    test('still shows the nearby orders of other reports next to the held one', () => {
        const held = sibling('o1', 1, { driver_assigned: assignedTo(ME) });
        const other = makeOrder('p1', { meta: { report_id: OTHER_REPORT, child_index: 1 } });
        const items = buildOrderList([sibling('o2', 2), other], [held]);
        expect(items.map((item) => item.order.id)).toEqual(['p1', 'o1']);
    });

    test('never merges or hides assigned orders, even two of the same report', () => {
        const first = sibling('o1', 1, { driver_assigned: assignedTo(ME) });
        const second = sibling('o2', 2, { driver_assigned: assignedTo(ME) });
        const items = buildOrderList([sibling('o3', 3)], [first, second]);
        expect(items.map((item) => item.order.id)).toEqual(['o1', 'o2']);
    });

    test('keeps orders without a report id as separate cards', () => {
        const items = buildOrderList([makeOrder('a'), makeOrder('b')], []);
        expect(items.map((item) => item.key)).toEqual(['a', 'b']);
        expect(ids(items[0].siblings)).toEqual(['a']);
    });

    test('lists nearby cards before assigned orders', () => {
        const held = makeOrder('c', { driver_assigned: assignedTo(ME) });
        const items = buildOrderList([makeOrder('a')], [held]);
        expect(items.map((item) => item.key)).toEqual(['a', 'c']);
    });

    test('shows an order once when a stale nearby copy is also in the current orders', () => {
        const mine = sibling('o1', 1, { driver_assigned: assignedTo(ME) });
        const items = buildOrderList([sibling('o1', 1), sibling('o2', 2)], [mine]);
        expect(items.map((item) => item.order.id)).toEqual(['o1']);
    });

    test('shows an order id once when the nearby feed repeats it', () => {
        const items = buildOrderList([makeOrder('a'), makeOrder('a')], []);
        expect(items).toHaveLength(1);
    });

    test('a dismissed order id hides that order only', () => {
        const items = buildOrderList([sibling('o1', 1), sibling('o2', 2)], [], ['o1']);
        expect(ids(items[0].siblings)).toEqual(['o2']);
    });

    test('a dismissed report key hides every unassigned sibling, including ones that appear later', () => {
        expect(buildOrderList([sibling('o1', 1), sibling('o2', 2)], [], [`report:${REPORT}`])).toEqual([]);
        expect(buildOrderList([sibling('o3', 3)], [], [`report:${REPORT}`])).toEqual([]);
    });

    test('a dismissed report key does not hide an order the driver holds', () => {
        const held = sibling('o1', 1, { driver_assigned: assignedTo(ME) });
        const items = buildOrderList([sibling('o2', 2)], [held], [`report:${REPORT}`]);
        expect(items.map((item) => item.order.id)).toEqual(['o1']);
    });

    test('a cancelled assignment (dismissed id) no longer counts as held, so the other siblings reappear', () => {
        const cancelled = sibling('o1', 1, { driver_assigned: assignedTo(ME) });
        const items = buildOrderList([sibling('o2', 2), sibling('o3', 3)], [cancelled], ['o1']);
        expect(items).toHaveLength(1);
        expect(ids(items[0].siblings)).toEqual(['o2', 'o3']);
    });
});

describe('dismissalKeysFor', () => {
    test('adds the report key for a BeeSure order', () => {
        expect(dismissalKeysFor(sibling('o1', 1))).toEqual(['o1', `report:${REPORT}`]);
    });

    test('is just the order id otherwise', () => {
        expect(dismissalKeysFor(makeOrder('a'))).toEqual(['a']);
    });
});

describe('findHeldSibling', () => {
    test('finds an assigned sibling, whatever its status', () => {
        const held = sibling('o1', 1, { driver_assigned: assignedTo(ME), status: 'completed' });
        expect(findHeldSibling(sibling('o2', 2), [held])).toBe(held);
    });

    test('ignores other reports, orders without a report id, the order itself and dismissed orders', () => {
        const other = makeOrder('p1', { meta: { report_id: OTHER_REPORT }, driver_assigned: assignedTo(ME) });
        const cancelled = sibling('o1', 1, { driver_assigned: assignedTo(ME) });
        expect(findHeldSibling(sibling('o2', 2), [other])).toBeNull();
        expect(findHeldSibling(makeOrder('a'), [cancelled])).toBeNull();
        expect(findHeldSibling(cancelled, [cancelled])).toBeNull();
        expect(findHeldSibling(sibling('o2', 2), [cancelled], ['o1'])).toBeNull();
    });
});

describe('listOpenSiblings', () => {
    test('returns the other unassigned siblings, lowest child index first', () => {
        const taken = sibling('o4', 1, { driver_assigned: assignedTo('driver_other') });
        const list = listOpenSiblings(sibling('o2', 2), [sibling('o3', 3), sibling('o2', 2), sibling('o1', 1), taken, makeOrder('p1', { meta: { report_id: OTHER_REPORT } })]);
        expect(ids(list)).toEqual(['o1', 'o3']);
    });

    test('is empty for an order without a report id', () => {
        expect(listOpenSiblings(makeOrder('a'), [sibling('o1', 1)])).toEqual([]);
    });
});

describe('messages', () => {
    test('heldMessage names the held order by tracking number, else by id', () => {
        expect(heldMessage(makeOrder('o1', { tracking_number: { tracking_number: 'JAV1SG' } }))).toContain('JAV1SG');
        expect(heldMessage(makeOrder('o1'))).toContain('o1');
    });

    test('dismissMessage mentions the other open siblings only when there are some', () => {
        expect(dismissMessage(0)).not.toContain('The other');
        expect(dismissMessage(1)).toContain('The other 1 open order of this validation');
        expect(dismissMessage(2)).toContain('The other 2 open orders of this validation');
    });
});

describe('assignmentOf', () => {
    test('free, mine and taken', () => {
        expect(assignmentOf(makeOrder('o1'), ME)).toBe('free');
        expect(assignmentOf(makeOrder('o1', { driver_assigned: assignedTo(ME) }), ME)).toBe('mine');
        expect(assignmentOf(makeOrder('o1', { driver_assigned: assignedTo('driver_other') }), ME)).toBe('taken');
    });
});

describe('claimFirstAvailable', () => {
    test('starts the first free candidate with the driver id', async () => {
        const first = sibling('o1', 1);
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('accepted');
        expect(result.order).toBe(first);
        expect(first.start).toHaveBeenCalledWith({ assign: ME });
        expect(second.reload).not.toHaveBeenCalled();
        expect(second.start).not.toHaveBeenCalled();
    });

    test('skips a candidate that is already taken without calling start on it', async () => {
        const first = makeOrder('o1', { meta: { report_id: REPORT, child_index: 1 }, driver_assigned: assignedTo('driver_other') });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('accepted');
        expect(result.order).toBe(second);
        expect(result.takenIds).toEqual(['o1']);
        expect(first.start).not.toHaveBeenCalled();
    });

    test('skips a released candidate (started, unassigned) without calling start on it', async () => {
        const released = sibling('o1', 1, { started: true });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([released, second], ME);
        expect(result.outcome).toBe('accepted');
        expect(result.order).toBe(second);
        expect(result.takenIds).toEqual(['o1']);
        expect(released.start).not.toHaveBeenCalled();
    });

    test('moves on when start loses the race, because the candidate is now taken', async () => {
        let started = false;
        const first = makeOrder('o1', { meta: { report_id: REPORT, child_index: 1 } }, {
            start: () => {
                started = true;
                throw new Error('Order has already been started');
            },
            reload: (order) => (started ? makeOrder('o1', { driver_assigned: assignedTo('driver_other') }) : order),
        });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('accepted');
        expect(result.order).toBe(second);
        expect(result.takenIds).toEqual(['o1']);
    });

    test('reports unavailable, without starting anything, when every candidate is taken', async () => {
        const taken = (id, index) => makeOrder(id, { meta: { report_id: REPORT, child_index: index }, driver_assigned: assignedTo('driver_other') });
        const candidates = [taken('o1', 1), taken('o2', 2), taken('o3', 3)];
        const result = await claimFirstAvailable(candidates, ME);
        expect(result.outcome).toBe('unavailable');
        expect(result.takenIds).toEqual(['o1', 'o2', 'o3']);
        candidates.forEach((candidate) => expect(candidate.start).not.toHaveBeenCalled());
    });

    test('treats a candidate already assigned to this driver as accepted and starts nothing else', async () => {
        const mine = makeOrder('o1', { meta: { report_id: REPORT, child_index: 1 }, driver_assigned: assignedTo(ME) });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([mine, second], ME);
        expect(result.outcome).toBe('accepted');
        expect(result.order).toBe(mine);
        expect(mine.start).not.toHaveBeenCalled();
        expect(second.reload).not.toHaveBeenCalled();
    });

    test('accepts when start fails after the server assigned this driver (a lost response)', async () => {
        let started = false;
        const first = makeOrder('o1', { meta: { report_id: REPORT, child_index: 1 } }, {
            start: () => {
                started = true;
                throw new Error('Network request failed');
            },
            reload: (order) => (started ? makeOrder('o1', { driver_assigned: assignedTo(ME) }) : order),
        });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('accepted');
        expect(result.order.id).toBe('o1');
        expect(second.start).not.toHaveBeenCalled();
    });

    test('stops at an unexplained start failure and never tries another candidate', async () => {
        const first = makeOrder('o1', { meta: { report_id: REPORT, child_index: 1 } }, {
            start: () => {
                throw new Error('Order has not been dispatched');
            },
        });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('error');
        expect(result.error.message).toBe('Order has not been dispatched');
        expect(second.reload).not.toHaveBeenCalled();
        expect(second.start).not.toHaveBeenCalled();
    });

    test('stops when a reload fails', async () => {
        const first = makeOrder('o1', {}, {
            reload: () => {
                throw new Error('Network request failed');
            },
        });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('error');
        expect(first.start).not.toHaveBeenCalled();
        expect(second.start).not.toHaveBeenCalled();
    });

    test('stops when start fails and the second look also fails', async () => {
        let started = false;
        const first = makeOrder('o1', {}, {
            start: () => {
                started = true;
                throw new Error('Network request failed');
            },
            reload: (order) => {
                if (started) {
                    throw new Error('Network request failed');
                }
                return order;
            },
        });
        const second = sibling('o2', 2);
        const result = await claimFirstAvailable([first, second], ME);
        expect(result.outcome).toBe('error');
        expect(second.start).not.toHaveBeenCalled();
    });

    test('reports unavailable for an empty candidate list', async () => {
        expect((await claimFirstAvailable([], ME)).outcome).toBe('unavailable');
    });
});

describe('isFinishedOrder', () => {
    test.each(['completed', 'canceled', 'order_canceled'])('%s is finished', (status) => {
        expect(isFinishedOrder(makeOrder('o1', { status }))).toBe(true);
    });

    test.each(['created', 'dispatched', 'driver_enroute', 'started'])('%s is not finished', (status) => {
        expect(isFinishedOrder(makeOrder('o1', { status }))).toBe(false);
    });

    test('an order without a status is not finished', () => {
        expect(isFinishedOrder(makeOrder('o1'))).toBe(false);
    });
});

describe('buildOrderList with finished orders hidden', () => {
    const mine = (id, childIndex, status) => sibling(id, childIndex, { driver_assigned: assignedTo(ME), status });
    const keys = (items) => items.map((item) => item.key);

    test('shows every assigned order when showFinished is true or left out', () => {
        const current = [mine('o1', 1, 'completed'), mine('o2', 2, 'canceled'), mine('o3', 3, 'order_canceled'), makeOrder('p1', { driver_assigned: assignedTo(ME), status: 'driver_enroute' })];
        expect(keys(buildOrderList([], current, []))).toEqual(['o1', 'o2', 'o3', 'p1']);
        expect(keys(buildOrderList([], current, [], true))).toEqual(['o1', 'o2', 'o3', 'p1']);
    });

    test('leaves out finished assigned orders and keeps the others in their order', () => {
        const current = [makeOrder('a', { driver_assigned: assignedTo(ME), status: 'dispatched' }), mine('b', 1, 'completed'), makeOrder('c', { driver_assigned: assignedTo(ME), status: 'started' }), mine('d', 2, 'canceled'), mine('e', 3, 'order_canceled')];
        expect(keys(buildOrderList([], current, [], false))).toEqual(['a', 'c']);
    });

    test('never filters the nearby cards, whatever their status', () => {
        const nearby = [makeOrder('n1', { status: 'canceled' }), makeOrder('n2', { status: 'completed' }), sibling('o1', 1, { status: 'canceled' })];
        expect(keys(buildOrderList(nearby, [], [], false))).toEqual(['n1', 'n2', `report:${REPORT}`]);
        expect(keys(buildOrderList(nearby, [], [], false))).toEqual(keys(buildOrderList(nearby, [], [], true)));
    });

    test('lists the nearby cards before the assigned orders, as with finished orders shown', () => {
        const current = [mine('o1', 1, 'completed'), makeOrder('a', { driver_assigned: assignedTo(ME), status: 'dispatched' })];
        expect(keys(buildOrderList([makeOrder('n1')], current, [], false))).toEqual(['n1', 'a']);
    });

    test('a report whose only held order is finished still shows no nearby card', () => {
        const held = mine('o1', 1, 'completed');
        const nearby = [sibling('o2', 2), sibling('o3', 3)];
        expect(keys(buildOrderList(nearby, [held], [], false))).toEqual([]);
        expect(keys(buildOrderList(nearby, [held], [], true))).toEqual(['o1']);
    });

    test('a stale nearby copy of a hidden finished order does not come back as a card', () => {
        expect(buildOrderList([sibling('o1', 1)], [mine('o1', 1, 'completed')], [], false)).toEqual([]);
    });

    test('a dismissed finished order no longer counts as held, so its report reappears whether or not finished orders are shown', () => {
        const cancelled = mine('o1', 1, 'canceled');
        [true, false].forEach((showFinished) => {
            const items = buildOrderList([sibling('o2', 2), sibling('o3', 3)], [cancelled], ['o1'], showFinished);
            expect(items).toHaveLength(1);
            expect(ids(items[0].siblings)).toEqual(['o2', 'o3']);
        });
    });
});

describe('listShownHeldOrders and countHiddenFinishedOrders', () => {
    const current = [makeOrder('a', { driver_assigned: assignedTo(ME), status: 'driver_enroute' }), makeOrder('b', { driver_assigned: assignedTo(ME), status: 'completed' }), makeOrder('c', { driver_assigned: assignedTo(ME), status: 'canceled' }), makeOrder('d', { driver_assigned: assignedTo(ME), status: 'dispatched' })];

    test('lists every assigned order by default, and leaves out dismissed ones', () => {
        expect(ids(listShownHeldOrders(current))).toEqual(['a', 'b', 'c', 'd']);
        expect(ids(listShownHeldOrders(current, ['d']))).toEqual(['a', 'b', 'c']);
    });

    test('leaves out finished orders when showFinished is false', () => {
        expect(ids(listShownHeldOrders(current, ['d'], false))).toEqual(['a']);
        expect(ids(listShownHeldOrders(current, [], false))).toEqual(['a', 'd']);
    });

    test('counts the finished orders left out, and 0 while they are shown', () => {
        expect(countHiddenFinishedOrders(current, ['d'], false)).toBe(2);
        expect(countHiddenFinishedOrders(current, ['c'], false)).toBe(1);
        expect(countHiddenFinishedOrders(current, ['d'], true)).toBe(0);
        expect(countHiddenFinishedOrders(current)).toBe(0);
    });

    test('shown plus hidden is everything that is not dismissed', () => {
        expect(listShownHeldOrders(current, ['d'], false).length + countHiddenFinishedOrders(current, ['d'], false)).toBe(listShownHeldOrders(current, ['d'], true).length);
    });
});

describe('finished-order texts', () => {
    test('the switch label is the one the docs and the harness name', () => {
        expect(SHOW_FINISHED_LABEL).toBe('Show finished orders');
    });

    test('hiddenFinishedMessage gives the count in the form the harness matches', () => {
        expect(hiddenFinishedMessage(1)).toBe('1 hidden');
        expect(hiddenFinishedMessage(12)).toBe('12 hidden');
        expect(hiddenFinishedMessage(12)).toMatch(/^[1-9]\d* hidden$/);
    });
});
