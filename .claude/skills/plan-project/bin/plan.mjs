#!/usr/bin/env node
/**
 * plan — print the plan report for a plan file.
 *
 *   node plan.mjs <plan.json> > plan-report.md
 *
 * Exit 0 with the report on stdout; exit 1 with the errors on stderr.
 */
import { readFileSync } from 'node:fs'
import { analyzePlan, renderReport, validatePlan } from '../lib/plan.mjs'

const USAGE = 'Usage: node plan.mjs <plan.json>\n'

const [file] = process.argv.slice(2)
if (!file || file === '--help' || file === '-h') {
  process.stderr.write(USAGE)
  process.exit(file ? 0 : 1)
}

let plan
try {
  plan = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  process.stderr.write(`plan: cannot read ${file}: ${error.message}\n`)
  process.exit(1)
}

const { errors, warnings } = validatePlan(plan)
if (errors.length > 0) {
  for (const message of errors) process.stderr.write(`plan: ${message}\n`)
  process.exit(1)
}

process.stdout.write(renderReport(analyzePlan(plan), warnings))
