/**
 * Project-plan arithmetic. Pure functions only: a plan object in, numbers or text out.
 *
 * Structure:
 *   validatePlan      - errors that stop the report, warnings that go in it
 *   schedule          - forward and backward pass over the dependency graph
 *   criticalChain     - the longest chain of dependent units
 *   deriveRoute       - who does a unit, from its uncertainty and whether it is on the path
 *   simulate          - calendar length of the plan with a given number of engineers
 *   analyzePlan       - everything above, assembled
 *   renderReport      - the analysis as Markdown
 *
 * Durations are working days. A unit estimated in review rounds is converted to days at
 * `assumptions.round_days`. The file format is documented in ../SKILL.md.
 */

/** The three ways a unit can be executed. */
export const ROUTE = Object.freeze({
  HUMAN: 'human only',
  LED: 'human-led',
  FANOUT: 'agent fan-out',
})

/** Unit kinds. Everything except `build` is work a gut estimate forgets. */
export const KINDS = Object.freeze(['build', 'preflight', 'spike', 'review', 'qa', 'launch', 'tail'])

const DAYS_PER_WEEK = 5
/** Focused hours of a person's time in one estimate-day, unless the plan says otherwise. */
const DEFAULT_FOCUS_HOURS = 6
const MINUTES_PER_HOUR = 60
/** A unit whose likely duration is above this is too big to estimate. */
const MAX_LIKELY_DAYS = 5
const EPSILON = 1e-9
const REVIEW_SUFFIX = '#review'

/**
 * @typedef {{ o: number, m: number, p: number }} Estimate optimistic, most likely, pessimistic
 * @typedef {{ id: string, title?: string, kind?: string, depends_on?: string[], complexity: number,
 *   uncertainty: number, estimate?: Estimate, rounds?: Estimate, owner_minutes?: number, route?: string,
 *   human_only?: boolean }} Unit a unit has `estimate` in days, or `rounds` with `owner_minutes`
 * @typedef {{ es: number, ef: number, ls: number, lf: number, float: number, critical: boolean }} Timing
 * @typedef {{ id: string, duration: number, engineer: boolean, deps: string[] }} Task
 */

/**
 * Three-point (PERT) expected duration.
 * @param {Estimate} estimate
 * @returns {number} expected working days
 */
export function expectedDays({ o, m, p }) {
  return (o + 4 * m + p) / 6
}

/**
 * Variance of a three-point estimate.
 * @param {Estimate} estimate
 * @returns {number}
 */
export function estimateVariance({ o, p }) {
  return ((p - o) / 6) ** 2
}

/**
 * A unit's three figures in working days. A unit estimated in review rounds is converted at
 * `roundDays` elapsed days per round.
 * @param {Unit} unit
 * @param {number | undefined} roundDays
 * @returns {Estimate}
 */
export function dayFigures(unit, roundDays) {
  if (unit.rounds === undefined) return unit.estimate
  const { o, m, p } = unit.rounds
  return { o: o * roundDays, m: m * roundDays, p: p * roundDays }
}

/**
 * Whether three figures are positive numbers in order.
 * @param {Estimate | undefined} figures
 * @returns {boolean}
 */
function isOrdered(figures) {
  const { o, m, p } = figures ?? {}
  const numeric = [o, m, p].every((value) => typeof value === 'number' && value > 0)
  return numeric && o <= m && m <= p
}

/**
 * Hours of a person's time a unit needs. An owned unit takes its whole duration at the focus hours of
 * a day. An agent-built unit takes its owner minutes, or its review fraction of the duration when it
 * is estimated in days.
 * @param {Unit} unit
 * @param {string} route one of ROUTE
 * @param {number} duration working days
 * @param {number | undefined} reviewFraction
 * @param {number} focusHours
 * @returns {number}
 */
export function ownerHours(unit, route, duration, reviewFraction, focusHours) {
  if (route !== ROUTE.FANOUT) return duration * focusHours
  if (unit.rounds !== undefined) return unit.owner_minutes / MINUTES_PER_HOUR
  if (reviewFraction !== undefined) return duration * reviewFraction * focusHours
  return duration * focusHours
}

/**
 * The dependencies of a unit, never undefined.
 * @param {Unit} unit
 * @returns {string[]}
 */
function depsOf(unit) {
  return unit.depends_on ?? []
}

/**
 * Units in dependency order.
 * @param {Unit[]} units
 * @returns {{ order: Unit[], cyclic: string[] }} `cyclic` lists the ids left over when the graph has a cycle
 */
export function topologicalOrder(units) {
  const remaining = new Map(units.map((unit) => [unit.id, depsOf(unit).length]))
  const order = []
  const queue = units.filter((unit) => depsOf(unit).length === 0)

  while (queue.length > 0) {
    const unit = queue.shift()
    order.push(unit)
    for (const successor of units) {
      if (!depsOf(successor).includes(unit.id)) continue
      const left = remaining.get(successor.id) - 1
      remaining.set(successor.id, left)
      if (left === 0) queue.push(successor)
    }
  }

  const placed = new Set(order.map((unit) => unit.id))
  return { order, cyclic: units.filter((unit) => !placed.has(unit.id)).map((unit) => unit.id) }
}

/**
 * Check a plan file.
 * @param {object} plan the parsed plan file
 * @returns {{ errors: string[], warnings: string[] }} errors stop the report; warnings are printed in it
 */
export function validatePlan(plan) {
  const errors = []
  const warnings = []
  const units = Array.isArray(plan?.units) ? plan.units : []

  if (units.length === 0) {
    return { errors: ['The plan has no units.'], warnings }
  }

  const ids = new Set()
  for (const unit of units) {
    if (typeof unit.id !== 'string' || unit.id === '') {
      errors.push('A unit has no id.')
      continue
    }
    if (ids.has(unit.id)) errors.push(`Unit id "${unit.id}" is used twice.`)
    ids.add(unit.id)
  }

  for (const unit of units) {
    const name = `Unit "${unit.id}"`
    for (const dep of depsOf(unit)) {
      if (dep === unit.id) errors.push(`${name} depends on itself.`)
      else if (!ids.has(dep)) errors.push(`${name} depends on "${dep}", which is not a unit.`)
    }
    for (const axis of ['complexity', 'uncertainty']) {
      if (![1, 2, 3].includes(unit[axis])) errors.push(`${name}: ${axis} must be 1, 2, or 3.`)
    }
    if (unit.kind !== undefined && !KINDS.includes(unit.kind)) {
      errors.push(`${name}: kind "${unit.kind}" is not one of ${KINDS.join(', ')}.`)
    }
    if (unit.route !== undefined && !Object.values(ROUTE).includes(unit.route)) {
      errors.push(`${name}: route "${unit.route}" is not one of ${Object.values(ROUTE).join(', ')}.`)
    }
    const inDays = unit.estimate !== undefined
    const inRounds = unit.rounds !== undefined
    if (inDays && inRounds) {
      errors.push(`${name}: give estimate (days) or rounds (review rounds), not both.`)
    } else if (inRounds) {
      if (!isOrdered(unit.rounds)) errors.push(`${name}: rounds needs o, m, and p, with 0 < o <= m <= p.`)
      if (!(typeof unit.owner_minutes === 'number' && unit.owner_minutes > 0)) {
        errors.push(`${name}: a unit estimated in rounds needs owner_minutes, the person's time on it.`)
      }
    } else if (!isOrdered(unit.estimate)) {
      errors.push(`${name}: estimate needs o, m, and p in days, with 0 < o <= m <= p.`)
    } else if (unit.estimate.m > MAX_LIKELY_DAYS) {
      warnings.push(`${name} is likely ${unit.estimate.m} days. Over a week: split it, or spike it first.`)
    }
  }

  const assumptions = plan.assumptions ?? {}
  if (units.some((unit) => unit.rounds !== undefined) && !(assumptions.round_days > 0)) {
    errors.push('assumptions.round_days must be above 0 when a unit is estimated in rounds.')
  }
  if (assumptions.owner_hours_per_week !== undefined && !(assumptions.owner_hours_per_week > 0)) {
    errors.push('assumptions.owner_hours_per_week must be above 0.')
  }
  const focus = assumptions.focus_hours_per_day
  if (focus !== undefined && !(focus > 0 && focus <= 24)) {
    errors.push('assumptions.focus_hours_per_day must be above 0 and at most 24.')
  }
  if (plan.appetite_weeks !== undefined && !(plan.appetite_weeks > 0)) {
    errors.push('appetite_weeks must be above 0.')
  }
  const milestone = plan.first_milestone
  if (milestone !== undefined) {
    const milestoneUnits = Array.isArray(milestone.units) ? milestone.units : []
    if (milestoneUnits.length === 0) errors.push('first_milestone.units must list at least one unit id.')
    for (const id of milestoneUnits) {
      if (!ids.has(id)) errors.push(`first_milestone lists "${id}", which is not a unit.`)
    }
  }

  if (errors.length > 0) return { errors, warnings }

  const { cyclic } = topologicalOrder(units)
  if (cyclic.length > 0) {
    return { errors: [`Dependency cycle among: ${cyclic.join(', ')}.`], warnings }
  }

  const byId = new Map(units.map((unit) => [unit.id, unit]))
  for (const unit of units) {
    const spiked = unit.kind === 'spike' || depsOf(unit).some((dep) => byId.get(dep).kind === 'spike')
    if (unit.uncertainty === 3 && !spiked) {
      warnings.push(`Unit "${unit.id}" has uncertainty 3 and no spike before it. Its estimate is a guess.`)
    }
  }

  const kinds = new Set(units.map((unit) => unit.kind ?? 'build'))
  for (const kind of ['preflight', 'qa', 'launch', 'tail']) {
    if (kinds.has(kind)) continue
    const why = kind === 'preflight'
      ? 'Accounts, quotas, secrets and rulesets have to be set up before the build; that is a unit, from a runbook.'
      : 'That work exists; put it on the plan.'
    warnings.push(`No unit of kind "${kind}". ${why}`)
  }

  const fraction = plan.assumptions?.agent_review_fraction
  if (fraction !== undefined && !(typeof fraction === 'number' && fraction > 0 && fraction <= 1)) {
    return { errors: ['assumptions.agent_review_fraction must be above 0 and at most 1.'], warnings }
  }
  const joins = units.filter((unit) => depsOf(unit).length >= 2).length
  if (joins > 0 && !(plan.assumptions?.join_buffer > 0)) {
    warnings.push(`${joins} unit(s) join two or more branches and assumptions.join_buffer is not set.`)
  }
  const references = Array.isArray(plan.reference_class) ? plan.reference_class : []
  if (!references.some((entry) => entry.units > 0 && entry.days > 0)) {
    warnings.push('No reference class. The estimate has no cross-check against finished work.')
  }
  if (!plan.recorded) warnings.push('No "recorded" date. An estimate of record is dated.')
  if (assumptions.owner_hours_per_week === undefined) {
    warnings.push('No assumptions.owner_hours_per_week. When the lead is part-time, their hours set the date; state them.')
  }
  if (plan.appetite_weeks === undefined) {
    warnings.push('No appetite_weeks. Fix the time first, what this is worth in weeks, then cut the scope to fit it.')
  }
  if (plan.first_milestone === undefined) {
    warnings.push('No first_milestone. Name the smallest thing the decision-maker can click through end to end.')
  }

  return { errors, warnings }
}

/**
 * Earliest and latest times for every unit.
 * @param {Unit[]} units
 * @param {(unit: Unit) => number} durationOf
 * @returns {{ timing: Map<string, Timing>, length: number }} `length` is the calendar floor in days
 */
export function schedule(units, durationOf) {
  const { order } = topologicalOrder(units)
  const timing = new Map()

  for (const unit of order) {
    const es = Math.max(0, ...depsOf(unit).map((dep) => timing.get(dep).ef))
    timing.set(unit.id, { es, ef: es + durationOf(unit), ls: 0, lf: 0, float: 0, critical: false })
  }
  const length = Math.max(...order.map((unit) => timing.get(unit.id).ef))

  for (const unit of order.toReversed()) {
    const successors = units.filter((other) => depsOf(other).includes(unit.id))
    const lf = Math.min(length, ...successors.map((other) => timing.get(other.id).ls))
    const entry = timing.get(unit.id)
    entry.lf = lf
    entry.ls = lf - durationOf(unit)
    entry.float = entry.ls - entry.es
    entry.critical = entry.float < EPSILON
  }

  return { timing, length }
}

/**
 * The longest chain of dependent units, first to last.
 * @param {Unit[]} units
 * @param {Map<string, Timing>} timing
 * @param {number} length
 * @returns {Unit[]}
 */
export function criticalChain(units, timing, length) {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const isCritical = (unit) => timing.get(unit.id).critical
  let current = units.find((unit) => isCritical(unit) && Math.abs(timing.get(unit.id).ef - length) < EPSILON)
  const chain = []

  while (current) {
    chain.unshift(current)
    const startsAt = timing.get(current.id).es
    current = depsOf(current)
      .map((dep) => byId.get(dep))
      .find((dep) => isCritical(dep) && Math.abs(timing.get(dep.id).ef - startsAt) < EPSILON)
  }
  return chain
}

/**
 * Who does a unit. Uncertainty is the routing variable; complexity is not.
 * @param {Unit} unit
 * @param {boolean} onPath whether the unit is on the critical path
 * @returns {string} one of ROUTE
 */
export function deriveRoute(unit, onPath) {
  if (unit.human_only || unit.kind === 'spike' || unit.kind === 'preflight' || unit.uncertainty === 3) return ROUTE.HUMAN
  if (unit.uncertainty === 2 || onPath) return ROUTE.LED
  return ROUTE.FANOUT
}

/**
 * Units as schedulable tasks. With fan-out, an agent-built unit keeps its duration: the first part
 * needs no engineer and the last part, the review, needs one. Fan-out frees engineers; it does not
 * shorten the path.
 * @param {Unit[]} units
 * @param {(unit: Unit) => number} durationOf
 * @param {(unit: Unit) => number | undefined} engineerShareOf days of engineer time at the end of an
 *   agent-built unit; undefined schedules the unit on an engineer throughout
 * @returns {Task[]}
 */
export function buildTasks(units, durationOf, engineerShareOf = () => undefined) {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const fannedOut = (id) => engineerShareOf(byId.get(id)) !== undefined
  const finishedId = (id) => (fannedOut(id) ? `${id}${REVIEW_SUFFIX}` : id)

  return units.flatMap((unit) => {
    const deps = depsOf(unit).map(finishedId)
    const duration = durationOf(unit)
    if (!fannedOut(unit.id)) return [{ id: unit.id, duration, engineer: true, deps }]
    const share = Math.min(duration, engineerShareOf(unit))
    return [
      { id: unit.id, duration: duration - share, engineer: false, deps },
      { id: finishedId(unit.id), duration: share, engineer: true, deps: [unit.id] },
    ]
  })
}

/**
 * Longest remaining path from each task to the end of the plan, used as scheduling priority.
 * @param {Task[]} tasks
 * @returns {Map<string, number>}
 */
function remainingPath(tasks) {
  const memo = new Map()
  const visit = (task) => {
    if (memo.has(task.id)) return memo.get(task.id)
    const successors = tasks.filter((other) => other.deps.includes(task.id))
    const tail = task.duration + Math.max(0, ...successors.map(visit))
    memo.set(task.id, tail)
    return tail
  }
  tasks.forEach(visit)
  return memo
}

/**
 * Calendar length of the plan with a fixed number of engineers. A free engineer always takes the
 * ready task with the longest path behind it.
 * @param {Task[]} tasks
 * @param {number} engineers
 * @returns {number} working days
 */
export function simulate(tasks, engineers) {
  const priority = remainingPath(tasks)
  const finished = new Set()
  const started = new Set()
  let running = []
  let free = engineers
  let now = 0

  while (finished.size < tasks.length) {
    const ready = tasks
      .filter((task) => !started.has(task.id) && task.deps.every((dep) => finished.has(dep)))
      .toSorted((a, b) => priority.get(b.id) - priority.get(a.id))

    for (const task of ready) {
      if (task.engineer && free === 0) continue
      if (task.engineer) free -= 1
      started.add(task.id)
      running.push({ task, end: now + task.duration })
    }

    now = Math.min(...running.map((entry) => entry.end))
    const done = running.filter((entry) => entry.end - now < EPSILON)
    running = running.filter((entry) => entry.end - now >= EPSILON)
    for (const { task } of done) {
      finished.add(task.id)
      if (task.engineer) free += 1
    }
  }
  return now
}

/**
 * The staffing options table: rows are added until another engineer stops helping.
 * @param {Unit[]} units
 * @param {(unit: Unit) => number} durationOf
 * @param {(unit: Unit) => number | undefined} engineerShareOf see buildTasks
 * @param {number} maxEngineers
 * @returns {{ label: string, days: number, binds: string }[]}
 */
export function staffingOptions(units, durationOf, engineerShareOf = () => undefined, maxEngineers = 6) {
  const serial = buildTasks(units, durationOf)
  const hasFanout = units.some((unit) => engineerShareOf(unit) !== undefined)
  const tasks = hasFanout ? buildTasks(units, durationOf, engineerShareOf) : serial
  const floor = simulate(tasks, tasks.length)
  const suffix = hasFanout ? ' + agent fan-out' : ''
  const noun = (count) => `${count} engineer${count === 1 ? '' : 's'}`

  const rows = [{ label: `${noun(1)}, no fan-out`, days: simulate(serial, 1), binds: 'Everything runs serially' }]
  let saturated = false

  for (let count = hasFanout ? 1 : 2; count <= maxEngineers; count += 1) {
    const days = simulate(tasks, count)
    const atFloor = days - floor < EPSILON
    let binds = hasFanout ? 'Engineer capacity: owned units and review of agent work' : 'Engineer capacity'
    if (atFloor) binds = saturated ? 'No further gain: the path is saturated' : 'The critical path: this is the floor'
    rows.push({ label: `${noun(count)}${suffix}`, days, binds })
    if (saturated) break
    saturated = atFloor
  }
  return rows
}

/**
 * Everything the report prints, as data.
 * @param {object} plan a plan that passed validatePlan
 * @returns {object}
 */
export function analyzePlan(plan) {
  const units = plan.units
  const assumptions = plan.assumptions ?? {}
  const joinBuffer = assumptions.join_buffer ?? 0
  const reviewFraction = assumptions.agent_review_fraction
  const roundDays = assumptions.round_days
  const focusHours = assumptions.focus_hours_per_day ?? DEFAULT_FOCUS_HOURS
  const hoursPerWeek = assumptions.owner_hours_per_week
  const figuresOf = (unit) => dayFigures(unit, roundDays)
  const bufferOf = (unit) => (depsOf(unit).length >= 2 ? joinBuffer : 0)
  const durationOf = (unit) => expectedDays(figuresOf(unit)) + bufferOf(unit)

  const { timing, length } = schedule(units, durationOf)
  const chain = criticalChain(units, timing, length)
  const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0)
  const sigma = Math.sqrt(sum(chain, (unit) => estimateVariance(figuresOf(unit))))

  const routes = new Map(units.map((unit) => [unit.id, unit.route ?? deriveRoute(unit, timing.get(unit.id).critical)]))
  const overrides = units
    .filter((unit) => unit.route !== undefined && unit.route !== deriveRoute(unit, timing.get(unit.id).critical))
    .map((unit) => ({ id: unit.id, declared: unit.route, derived: deriveRoute(unit, timing.get(unit.id).critical) }))

  // Rounds price agent-built work; days price a person's. A unit whose route and unit of estimate
  // disagree is flagged, because review rounds, not build time, set an agent-built unit's pace.
  const checks = []
  for (const unit of units) {
    const route = routes.get(unit.id)
    if (route === ROUTE.FANOUT && unit.rounds === undefined) {
      checks.push(`Unit "${unit.id}" is agent-built and estimated in days. Estimate it in review rounds and owner minutes.`)
    }
    if (route !== ROUTE.FANOUT && unit.rounds !== undefined) {
      checks.push(`Unit "${unit.id}" is estimated in rounds but routes ${route}. Give it a day estimate.`)
    }
  }

  const engineerShareOf = (unit) => {
    if (routes.get(unit.id) !== ROUTE.FANOUT) return undefined
    if (unit.rounds !== undefined) return unit.owner_minutes / MINUTES_PER_HOUR / focusHours
    if (reviewFraction !== undefined) return durationOf(unit) * reviewFraction
    return undefined
  }

  const hoursOf = (unit) => ownerHours(unit, routes.get(unit.id), durationOf(unit), reviewFraction, focusHours)
  const agentBuilt = units.filter((unit) => routes.get(unit.id) === ROUTE.FANOUT)
  const ownerTotal = sum(units, hoursOf)
  const ownerWeeks = hoursPerWeek === undefined ? undefined : ownerTotal / hoursPerWeek

  // The first walkable milestone is scheduled on its own: its units and everything they depend on.
  let milestone
  if (plan.first_milestone !== undefined) {
    const needed = withPrerequisites(units, plan.first_milestone.units)
    const milestoneUnits = units.filter((unit) => needed.has(unit.id))
    const milestoneHours = sum(milestoneUnits, hoursOf)
    milestone = {
      title: plan.first_milestone.title ?? 'First milestone',
      ids: milestoneUnits.map((unit) => unit.id),
      floor: schedule(milestoneUnits, durationOf).length,
      ownerHours: milestoneHours,
      ownerWeeks: hoursPerWeek === undefined ? undefined : milestoneHours / hoursPerWeek,
    }
  }

  // Fix the time, vary the scope: a plan that runs past its appetite is cut before the build starts.
  const appetite = plan.appetite_weeks
  if (appetite !== undefined && length > appetite * DAYS_PER_WEEK) {
    checks.push(
      `The floor is ${formatWeeks(length)} weeks, over the appetite of ${appetite} weeks. ` +
        'Cut or park units until it fits; no staffing beats the floor.',
    )
  }
  if (appetite !== undefined && ownerWeeks !== undefined && ownerWeeks > appetite) {
    checks.push(
      `The lead's own time is ${ownerWeeks.toFixed(1)} weeks at ${hoursPerWeek} hours a week, over the appetite of ` +
        `${appetite} weeks. Cut units, give owned units to other people, or raise the hours.`,
    )
  }

  const serialDays = sum(units, durationOf)
  const references = (plan.reference_class ?? [])
    .filter((entry) => entry.units > 0 && entry.days > 0)
    .map((entry) => {
      const predicted = (entry.days / entry.units) * units.length
      return { name: entry.name, perUnit: entry.days / entry.units, predicted, ratio: serialDays / predicted }
    })

  return {
    project: plan.project ?? 'Untitled project',
    recorded: plan.recorded,
    units: units.map((unit) => ({
      ...unit,
      kind: unit.kind ?? 'build',
      deps: depsOf(unit),
      expected: expectedDays(figuresOf(unit)),
      buffer: bufferOf(unit),
      route: routes.get(unit.id),
      ownerHours: hoursOf(unit),
      ...timing.get(unit.id),
    })),
    path: {
      ids: chain.map((unit) => unit.id),
      expected: length,
      low: Math.max(0, length - 2 * sigma),
      high: length + 2 * sigma,
      optimistic: sum(chain, (unit) => figuresOf(unit).o + bufferOf(unit)),
      pessimistic: sum(chain, (unit) => figuresOf(unit).p + bufferOf(unit)),
    },
    serialDays,
    overrides,
    references,
    reviewFraction,
    roundDays,
    joinBuffer,
    checks,
    owner: {
      hours: ownerTotal,
      onAgentUnits: sum(agentBuilt, hoursOf),
      focusHours,
      hoursPerWeek,
      weeks: ownerWeeks,
      calibrated: assumptions.calibrated || undefined,
    },
    appetite,
    milestone,
    staffing: staffingOptions(units, durationOf, engineerShareOf),
  }
}

/**
 * The given units and every unit they depend on, directly or through others.
 * @param {Unit[]} units
 * @param {string[]} ids
 * @returns {Set<string>}
 */
export function withPrerequisites(units, ids) {
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const needed = new Set()
  const stack = [...ids]
  while (stack.length > 0) {
    const id = stack.pop()
    if (needed.has(id)) continue
    needed.add(id)
    stack.push(...depsOf(byId.get(id)))
  }
  return needed
}

/**
 * Days to one decimal place.
 * @param {number} days
 * @returns {string}
 */
function formatDays(days) {
  return days.toFixed(1)
}

/**
 * Days as weeks, to one decimal place.
 * @param {number} days
 * @returns {string}
 */
function formatWeeks(days) {
  return (days / DAYS_PER_WEEK).toFixed(1)
}

/**
 * A list as prose: "a, b and c".
 * @param {string[]} items
 * @returns {string}
 */
function joinWords(items) {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

/**
 * The dependency graph as a Mermaid flowchart, critical path highlighted.
 * @param {object} analysis the result of analyzePlan
 * @returns {string}
 */
export function renderMermaid(analysis) {
  const node = (id) => `u_${id.replace(/[^A-Za-z0-9]/g, '_')}`
  const label = (unit) => (unit.title ?? unit.id).replace(/"/g, "'")
  const lines = ['graph LR']
  for (const unit of analysis.units) lines.push(`  ${node(unit.id)}["${label(unit)}"]`)
  for (const unit of analysis.units) {
    for (const dep of unit.deps) lines.push(`  ${node(dep)} --> ${node(unit.id)}`)
  }
  const critical = analysis.units.filter((unit) => unit.critical).map((unit) => node(unit.id))
  const fanout = analysis.units.filter((unit) => unit.route === ROUTE.FANOUT).map((unit) => node(unit.id))
  lines.push('  classDef critical fill:#c4622d,stroke:#c4622d,color:#ffffff')
  lines.push('  classDef fanout fill:#2d6a6b,stroke:#2d6a6b,color:#ffffff')
  if (critical.length > 0) lines.push(`  class ${critical.join(',')} critical`)
  if (fanout.length > 0) lines.push(`  class ${fanout.join(',')} fanout`)
  return lines.join('\n')
}

/**
 * The one paragraph the plan exists to make sayable.
 * @param {object} analysis the result of analyzePlan
 * @returns {string}
 */
export function renderSentence(analysis) {
  const titleOf = (id) => {
    const unit = analysis.units.find((candidate) => candidate.id === id)
    return unit.title ?? unit.id
  }
  const { path, staffing } = analysis
  const offPath = analysis.units.filter((unit) => !unit.critical).map((unit) => unit.title ?? unit.id)
  const floorRow = staffing.find((row) => row.binds.startsWith('The critical path'))
  const parts = [
    `Critical path is ${joinWords(path.ids.map(titleOf))}: about ${formatWeeks(path.expected)} weeks, ` +
      `range ${formatWeeks(path.low)} to ${formatWeeks(path.high)}.`,
  ]
  if (offPath.length > 0) parts.push(`${joinWords(offPath)} ${offPath.length === 1 ? 'is' : 'are'} off it.`)
  parts.push(`One engineer with no fan-out is ${formatWeeks(staffing[0].days)} weeks serial.`)
  if (floorRow && floorRow !== staffing[0]) {
    parts.push(`The floor is ${formatWeeks(floorRow.days)} weeks, reached with ${floorRow.label}; more people add nothing.`)
  }
  const { owner } = analysis
  if (owner.weeks !== undefined) {
    parts.push(`At ${owner.hoursPerWeek} hours a week, the lead's own time is ${owner.weeks.toFixed(1)} weeks.`)
  }
  if (analysis.milestone) {
    parts.push(`The first walkable milestone, ${analysis.milestone.title}, has a floor of ${formatWeeks(analysis.milestone.floor)} weeks.`)
  }
  return parts.join(' ')
}

/**
 * A unit's estimate as the report prints it.
 * @param {object} unit a unit from analyzePlan
 * @returns {string}
 */
function formatEstimate(unit) {
  if (unit.rounds !== undefined) {
    const { o, m, p } = unit.rounds
    return `${o} / ${m} / ${p} rounds, ${unit.owner_minutes} min`
  }
  const { o, m, p } = unit.estimate
  return `${o} / ${m} / ${p} days`
}

/**
 * The analysis as a Markdown report.
 * @param {object} analysis the result of analyzePlan
 * @param {string[]} warnings warnings from validatePlan
 * @returns {string}
 */
export function renderReport(analysis, warnings = []) {
  const { path, units } = analysis
  const out = []
  const row = (cells) => `| ${cells.join(' | ')} |`

  out.push(`# Plan report: ${analysis.project}`, '')
  out.push(`Recorded ${analysis.recorded ?? 'not recorded'}. Durations are working days; a week is ${DAYS_PER_WEEK}.`, '')

  const checks = [...warnings, ...analysis.checks]
  out.push('## Checks', '')
  out.push(...(checks.length > 0 ? checks.map((check) => `- ${check}`) : ['- No warnings.']), '')

  out.push('## Units', '')
  out.push(row(['Unit', 'Kind', 'C', 'U', 'Depends on', 'o / m / p', 'Expected', 'Start', 'Finish', 'Float', 'On path', 'Route']))
  out.push(row(Array(12).fill('---')))
  for (const unit of units) {
    const expected = unit.buffer > 0 ? `${formatDays(unit.expected)} + ${formatDays(unit.buffer)}` : formatDays(unit.expected)
    out.push(row([
      `\`${unit.id}\``, unit.kind, unit.complexity, unit.uncertainty, unit.deps.join(', ') || 'none',
      formatEstimate(unit), expected, formatDays(unit.es), formatDays(unit.ef), formatDays(unit.float),
      unit.critical ? 'yes' : 'no', unit.route,
    ]))
  }
  out.push('')

  out.push('## Critical path', '')
  out.push(`\`${path.ids.join(' -> ')}\``, '')
  out.push(
    `Expected ${formatDays(path.expected)} days (${formatWeeks(path.expected)} weeks). ` +
      `Range ${formatDays(path.low)} to ${formatDays(path.high)} days ` +
      `(${formatWeeks(path.low)} to ${formatWeeks(path.high)} weeks) at two standard deviations, ` +
      'which assumes the unit estimates are independent.',
  )
  out.push(
    `Every unit at its optimistic figure: ${formatDays(path.optimistic)} days. ` +
      `Every unit at its pessimistic figure: ${formatDays(path.pessimistic)} days.`,
  )
  if (analysis.joinBuffer > 0) out.push(`A join buffer of ${formatDays(analysis.joinBuffer)} days is added to each unit with two or more dependencies.`)
  out.push('')

  const offPath = units.filter((unit) => !unit.critical)
  out.push('## Off the path', '')
  if (offPath.length === 0) {
    out.push('Every unit is on the critical path. Nothing can run in parallel.', '')
  } else {
    out.push(row(['Unit', 'Float (days)', 'Route']), row(['---', '---', '---']))
    for (const unit of offPath) out.push(row([`\`${unit.id}\``, formatDays(unit.float), unit.route]))
    out.push('')
  }

  out.push('## Execution model', '')
  out.push(row(['Route', 'Units', 'Days']), row(['---', '---', '---']))
  for (const route of Object.values(ROUTE)) {
    const routed = units.filter((unit) => unit.route === route)
    const days = routed.reduce((total, unit) => total + unit.expected + unit.buffer, 0)
    out.push(row([route, routed.map((unit) => `\`${unit.id}\``).join(', ') || 'none', formatDays(days)]))
  }
  out.push('')
  for (const { id, declared, derived } of analysis.overrides) {
    out.push(`- \`${id}\` is declared ${declared}; its scores and path position give ${derived}.`)
  }
  if (analysis.overrides.length > 0) out.push('')

  out.push('## Staffing', '')
  out.push(row(['Staffing', 'Duration', 'What binds it']), row(['---', '---', '---']))
  for (const option of analysis.staffing) {
    out.push(row([option.label, `${formatWeeks(option.days)} weeks (${formatDays(option.days)} days)`, option.binds]))
  }
  out.push('')
  const { owner } = analysis
  const agentBuilt = units.filter((unit) => unit.route === ROUTE.FANOUT)
  const inRounds = agentBuilt.filter((unit) => unit.rounds !== undefined)
  const inDays = agentBuilt.filter((unit) => unit.rounds === undefined)
  if (agentBuilt.length === 0) out.push('No unit is agent-built, so there are no fan-out rows.')
  if (inRounds.length > 0) {
    out.push(
      `Agent-built units estimated in rounds take ${formatDays(analysis.roundDays)} days a round, and an engineer ` +
        `for their owner minutes at the end, at ${owner.focusHours} focus hours a day. ` +
        'The no-fan-out row prices them at that agent time, so it understates a team working without agents.',
    )
  }
  if (inDays.length > 0 && analysis.reviewFraction === undefined) {
    out.push(
      `${inDays.length} agent-built unit(s) are estimated in days and \`assumptions.agent_review_fraction\` is not set, ` +
        'so they are scheduled on an engineer throughout.',
    )
  } else if (inDays.length > 0) {
    out.push(
      `Agent-built units estimated in days keep their expected duration, and an engineer is needed for the last ` +
        `${Math.round(analysis.reviewFraction * 100)}% of each, the review.`,
    )
  }
  out.push('')

  out.push('## Owner time', '')
  out.push(
    `The plan needs ${owner.hours.toFixed(0)} hours of a person's time: ` +
      `${(owner.hours - owner.onAgentUnits).toFixed(0)} on units a person owns, at ${owner.focusHours} focus hours a day, ` +
      `and ${owner.onAgentUnits.toFixed(0)} on agent-built units.`,
  )
  if (owner.weeks === undefined) {
    out.push('Set `assumptions.owner_hours_per_week` to turn this into weeks.')
  } else {
    out.push(
      `At ${owner.hoursPerWeek} hours a week from one lead, that is ${owner.weeks.toFixed(1)} weeks, ` +
        `against a floor of ${formatWeeks(path.expected)} weeks.`,
    )
    if (owner.weeks * DAYS_PER_WEEK > path.expected) {
      out.push("The lead's hours, not the graph, set the date, unless other people take owned units.")
    }
  }
  if (owner.calibrated) {
    out.push(`Rounds, owner minutes and the review fraction were calibrated from actuals on ${owner.calibrated}.`)
  } else {
    out.push(
      'Rounds per unit, owner minutes, owner hours a week and the review fraction are assumptions until the ' +
        'delta log measures them after the third agent-built merge.',
    )
  }
  out.push('')

  out.push('## Appetite and first milestone', '')
  const { appetite, milestone } = analysis
  if (appetite === undefined) {
    out.push('No appetite set.')
  } else {
    const fits = path.expected <= appetite * DAYS_PER_WEEK && (owner.weeks === undefined || owner.weeks <= appetite)
    out.push(
      `Appetite: ${appetite} weeks. Floor ${formatWeeks(path.expected)} weeks` +
        (owner.weeks === undefined ? '' : `; the lead's own time ${owner.weeks.toFixed(1)} weeks`) +
        (fits ? '. The plan fits.' : '. The plan does not fit: cut or park units before the build starts.'),
    )
  }
  if (milestone === undefined) {
    out.push('No first walkable milestone set.')
  } else {
    out.push(
      `${milestone.title}: ${milestone.ids.length} units with their prerequisites ` +
        `(${milestone.ids.map((id) => `\`${id}\``).join(', ')}). Floor ${formatWeeks(milestone.floor)} weeks` +
        (milestone.ownerWeeks === undefined
          ? '.'
          : `; the lead's own time ${milestone.ownerWeeks.toFixed(1)} weeks at ${owner.hoursPerWeek} hours a week.`),
    )
  }
  out.push('')

  out.push('## Cross-check', '')
  out.push(
    `Serial total: ${formatDays(analysis.serialDays)} days over ${units.length} units, ` +
      `${formatDays(analysis.serialDays / units.length)} days per unit.`,
  )
  if (analysis.references.length === 0) out.push('No reference class to compare against.')
  for (const reference of analysis.references) {
    out.push(
      `- ${reference.name}: ${formatDays(reference.perUnit)} days per unit predicts ${formatDays(reference.predicted)} days. ` +
        `This plan is ${reference.ratio.toFixed(2)} times that.`,
    )
  }
  out.push('')

  out.push('## The sentence', '', `> ${renderSentence(analysis)}`, '')
  out.push('## Graph', '', '```mermaid', renderMermaid(analysis), '```', '')
  return out.join('\n')
}
