import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ROUTE,
  analyzePlan,
  buildTasks,
  criticalChain,
  dayFigures,
  deriveRoute,
  expectedDays,
  ownerHours,
  renderReport,
  schedule,
  simulate,
  staffingOptions,
  validatePlan,
  withPrerequisites,
} from './plan.mjs'

/** A valid unit; pass overrides for the field under test. */
function unit(id, overrides = {}) {
  return { id, complexity: 1, uncertainty: 1, estimate: { o: 1, m: 2, p: 3 }, ...overrides }
}

/** A plan that passes every check, so one change produces exactly one message. */
function cleanPlan(units) {
  return {
    recorded: '2026-01-05',
    appetite_weeks: 52,
    first_milestone: { title: 'Walkable', units: ['qa'] },
    assumptions: { owner_hours_per_week: 15 },
    reference_class: [{ name: 'Earlier project', units: 4, days: 10 }],
    units: [
      ...units,
      unit('preflight', { kind: 'preflight' }),
      unit('qa', { kind: 'qa' }),
      unit('launch', { kind: 'launch' }),
      unit('tail', { kind: 'tail' }),
    ],
  }
}

/** a -> (long | short) -> end: `long` is on the path, `short` has float. */
const DIAMOND = [
  unit('a'),
  unit('long', { depends_on: ['a'], estimate: { o: 4, m: 4, p: 4 } }),
  unit('short', { depends_on: ['a'], estimate: { o: 1, m: 1, p: 1 } }),
  unit('end', { depends_on: ['long', 'short'] }),
]

test('expectedDays weights the likely figure four times', () => {
  assert.equal(expectedDays({ o: 3, m: 5, p: 13 }), 6)
})

const INVALID = [
  ['no units', { units: [] }, /no units/],
  ['a repeated id', { units: [unit('a'), unit('a')] }, /used twice/],
  ['an unknown dependency', { units: [unit('a', { depends_on: ['ghost'] })] }, /not a unit/],
  ['a score outside 1 to 3', { units: [unit('a', { uncertainty: 4 })] }, /uncertainty must be/],
  ['an estimate out of order', { units: [unit('a', { estimate: { o: 5, m: 2, p: 3 } })] }, /o <= m <= p/],
  ['a cycle', { units: [unit('a', { depends_on: ['b'] }), unit('b', { depends_on: ['a'] })] }, /cycle among: a, b/],
  [
    'a unit estimated in both days and rounds',
    { assumptions: { round_days: 0.5 }, units: [unit('a', { rounds: { o: 1, m: 2, p: 3 }, owner_minutes: 30 })] },
    /not both/,
  ],
  [
    'rounds with no owner minutes',
    { assumptions: { round_days: 0.5 }, units: [unit('a', { estimate: undefined, rounds: { o: 1, m: 2, p: 3 } })] },
    /needs owner_minutes/,
  ],
  [
    'rounds with no round_days',
    { units: [unit('a', { estimate: undefined, rounds: { o: 1, m: 2, p: 3 }, owner_minutes: 30 })] },
    /round_days must be above 0/,
  ],
  ['a milestone naming an unknown unit', { first_milestone: { units: ['ghost'] }, units: [unit('a')] }, /"ghost", which is not a unit/],
  ['an appetite of zero', { appetite_weeks: 0, units: [unit('a')] }, /appetite_weeks must be above 0/],
]

for (const [name, plan, message] of INVALID) {
  test(`validatePlan rejects ${name}`, () => {
    const { errors } = validatePlan(plan)
    assert.equal(errors.length, 1)
    assert.match(errors[0], message)
  })
}

const WARNED = [
  ['a unit likely over a week', [unit('a', { estimate: { o: 4, m: 8, p: 9 } })], /Over a week/],
  ['uncertainty 3 with no spike before it', [unit('a', { uncertainty: 3 })], /no spike/],
  ['a join with no buffer', [unit('a'), unit('b'), unit('c', { depends_on: ['a', 'b'] })], /join_buffer/],
]

for (const [name, units, message] of WARNED) {
  test(`validatePlan warns about ${name}`, () => {
    const { errors, warnings } = validatePlan(cleanPlan(units))
    assert.deepEqual(errors, [])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], message)
  })
}

test('validatePlan warns once for each missing kind of non-build work', () => {
  const plan = { ...cleanPlan([]), units: [unit('a')], first_milestone: { units: ['a'] } }
  assert.deepEqual(
    validatePlan(plan).warnings.map((warning) => warning.match(/kind "(\w+)"/)[1]),
    ['preflight', 'qa', 'launch', 'tail'],
  )
})

test('validatePlan warns when the lead has no weekly hours', () => {
  const plan = { ...cleanPlan([unit('a')]), assumptions: {} }
  const { warnings } = validatePlan(plan)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /owner_hours_per_week/)
})

const UNSHAPED = [
  ['no appetite', 'appetite_weeks', /No appetite_weeks/],
  ['no first milestone', 'first_milestone', /No first_milestone/],
]

for (const [name, field, message] of UNSHAPED) {
  test(`validatePlan warns about ${name}`, () => {
    const plan = cleanPlan([unit('a')])
    delete plan[field]
    const { warnings } = validatePlan(plan)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], message)
  })
}

test('a spike before an uncertainty-3 unit clears the warning', () => {
  const units = [unit('spike', { kind: 'spike', uncertainty: 3 }), unit('a', { uncertainty: 3, depends_on: ['spike'] })]
  assert.deepEqual(validatePlan(cleanPlan(units)).warnings, [])
})

test('the critical path is the longest chain, and the other branch carries the difference as float', () => {
  const { timing, length } = schedule(DIAMOND, (item) => expectedDays(item.estimate))
  assert.equal(length, 8)
  assert.deepEqual(criticalChain(DIAMOND, timing, length).map((item) => item.id), ['a', 'long', 'end'])
  assert.equal(timing.get('short').float, 3)
})

const ROUTED = [
  ['uncertainty 3', unit('a', { uncertainty: 3 }), false, ROUTE.HUMAN],
  ['a spike', unit('a', { kind: 'spike' }), false, ROUTE.HUMAN],
  ['a unit flagged human_only', unit('a', { human_only: true }), false, ROUTE.HUMAN],
  ['the preflight, however certain', unit('a', { kind: 'preflight' }), false, ROUTE.HUMAN],
  ['uncertainty 2', unit('a', { uncertainty: 2 }), false, ROUTE.LED],
  ['uncertainty 1 on the path', unit('a'), true, ROUTE.LED],
  ['uncertainty 1 off the path, however complex', unit('a', { complexity: 3 }), false, ROUTE.FANOUT],
]

for (const [name, item, onPath, expected] of ROUTED) {
  test(`deriveRoute sends ${name} to ${expected}`, () => {
    assert.equal(deriveRoute(item, onPath), expected)
  })
}

test('simulate runs independent work serially with one engineer and side by side with two', () => {
  const tasks = [
    { id: 'a', duration: 3, engineer: true, deps: [] },
    { id: 'b', duration: 5, engineer: true, deps: [] },
  ]
  assert.equal(simulate(tasks, 1), 8)
  assert.equal(simulate(tasks, 2), 5)
})

test('a fanned-out unit keeps its duration and needs an engineer only for the review', () => {
  const tasks = buildTasks([unit('a')], () => 4, () => 1)
  assert.deepEqual(tasks.map((task) => [task.duration, task.engineer]), [[3, false], [1, true]])
  assert.equal(simulate(tasks, 1), 4)
})

test('staffingOptions stops one row after another engineer stops helping', () => {
  const rows = staffingOptions(DIAMOND, (item) => expectedDays(item.estimate))
  assert.deepEqual(rows.map((row) => row.days), [9, 8, 8])
  assert.match(rows.at(-1).binds, /No further gain/)
})

test('dayFigures converts review rounds to days and leaves a day estimate alone', () => {
  const inRounds = unit('a', { estimate: undefined, rounds: { o: 1, m: 2, p: 6 }, owner_minutes: 30 })
  assert.deepEqual(dayFigures(inRounds, 0.5), { o: 0.5, m: 1, p: 3 })
  assert.deepEqual(dayFigures(unit('b'), 0.5), { o: 1, m: 2, p: 3 })
})

const OWNED = [
  ['an owned unit, its whole duration', unit('a'), ROUTE.LED, 12],
  ['an agent-built unit in rounds, its owner minutes', unit('a', { rounds: { o: 1, m: 2, p: 3 }, owner_minutes: 90 }), ROUTE.FANOUT, 1.5],
  ['an agent-built unit in days, its review fraction', unit('a'), ROUTE.FANOUT, 3],
]

for (const [name, item, route, expected] of OWNED) {
  test(`ownerHours charges ${name}`, () => {
    assert.equal(ownerHours(item, route, 2, 0.25, 6), expected)
  })
}

test('analyzePlan flags an agent-built unit estimated in days, and a rounds unit a person owns', () => {
  const plan = {
    ...cleanPlan([]),
    assumptions: { owner_hours_per_week: 15, round_days: 0.5 },
    first_milestone: { units: ['path'] },
    units: [
      unit('path', { estimate: { o: 5, m: 5, p: 5 } }),
      unit('side'),
      unit('owned', { estimate: undefined, uncertainty: 2, rounds: { o: 1, m: 2, p: 3 }, owner_minutes: 30 }),
    ],
  }
  const checks = analyzePlan(plan).checks
  assert.equal(checks.length, 2)
  assert.match(checks[0], /"side" is agent-built and estimated in days/)
  assert.match(checks[1], /"owned" is estimated in rounds but routes human-led/)
})

test('owner time turns into weeks at the lead\'s hours, and the report says when it sets the date', () => {
  const plan = {
    ...cleanPlan([]),
    assumptions: { owner_hours_per_week: 6, focus_hours_per_day: 6, round_days: 0.5 },
    first_milestone: { units: ['owned'] },
    units: [
      unit('owned', { estimate: { o: 2, m: 2, p: 2 } }),
      unit('agent', { estimate: undefined, rounds: { o: 2, m: 2, p: 2 }, owner_minutes: 60 }),
    ],
  }
  const analysis = analyzePlan(plan)
  assert.equal(analysis.owner.hours, 13)
  assert.equal(analysis.owner.onAgentUnits, 1)
  assert.equal(analysis.owner.weeks.toFixed(2), '2.17')
  assert.match(renderReport(analysis), /The lead's hours, not the graph, set the date/)
})

test('withPrerequisites follows dependencies through other units', () => {
  assert.deepEqual([...withPrerequisites(DIAMOND, ['end'])].toSorted(), ['a', 'end', 'long', 'short'])
  assert.deepEqual([...withPrerequisites(DIAMOND, ['short'])].toSorted(), ['a', 'short'])
})

test('the first milestone is scheduled on its own, prerequisites included', () => {
  const plan = { ...cleanPlan([]), units: DIAMOND, first_milestone: { title: 'Long branch', units: ['long'] } }
  const { milestone } = analyzePlan(plan)
  assert.deepEqual(milestone.ids, ['a', 'long'])
  assert.equal(milestone.floor, 6)
})

test('a floor past the appetite is flagged, and so is the lead\'s time', () => {
  const plan = { ...cleanPlan([]), units: DIAMOND, appetite_weeks: 1, first_milestone: { units: ['a'] } }
  const checks = analyzePlan(plan).checks.filter((check) => /appetite/.test(check))
  assert.equal(checks.length, 2)
  assert.match(checks[0], /The floor is 1.6 weeks, over the appetite of 1 weeks/)
  assert.match(checks[1], /The lead's own time is/)
})

test('the worked example reports its path and a floor no staffing option beats', () => {
  const plan = JSON.parse(readFileSync(new URL('../references/example-plan.json', import.meta.url), 'utf8'))
  const { errors, warnings } = validatePlan(plan)
  const analysis = analyzePlan(plan)

  assert.deepEqual([errors, warnings, analysis.checks], [[], [], []])
  assert.deepEqual(analysis.path.ids, ['preflight', 'schema', 'authz', 'api-members', 'cutover', 'qa-pass', 'ramp', 'tail'])
  assert.ok(analysis.milestone.floor < analysis.path.expected)
  assert.ok(analysis.staffing.every((row) => row.days >= analysis.path.expected - 1e-9))
  assert.match(renderReport(analysis), /`preflight -> schema -> authz -> api-members -> cutover -> qa-pass -> ramp -> tail`/)
})
