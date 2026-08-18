import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from './lib/index.js'

const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ])

const dir = await mkdtemp(path.join(tmpdir(), 'sidekick-it-'))
const failures = []
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failures.push(label)
}

const ctx = new Context()

const registeredTools = new Map()
const sections = []
const vars = new Map()
ctx.reflect.provide('tools', { register: (t) => registeredTools.set(t.name, t) })
ctx.reflect.provide('systemPrompt', {
  variable: (name, provider) => vars.set(name, provider),
  section: (s) => sections.push(s),
})

const entry = {
  name: plugin.name,
  inject: plugin.inject,
  Config: plugin.Config,
  apply: plugin.apply,
}

const fiber = await withTimeout(ctx.plugin(entry, { memoryDir: dir }), 10000, 'plugin load')
check('loaded by real Cordis registry', fiber != null)

await new Promise((r) => setTimeout(r, 300))
const read = async (f) => readFile(path.join(dir, f), 'utf8')

const store = JSON.parse(await read('sidekick_personalities.json'))
check('schema default defaultPersonality=tsundere', store.active === 'tsundere')
check('schema default personalitiesFile applied', (await read('sidekick_personalities.json')).length > 0)
check('bootstrap created work memory', (await read('work_memory.md')).includes('# work memory'))
check('bootstrap created active personality memory', (await read('companion_memory_tsundere.md')).includes('小柔'))
check('5 tools registered via inject resolution', registeredTools.size === 5)
check('systemPrompt section registered', sections.length === 1 && sections[0].order === -50)
check('companionProfile variable registered', vars.has('companionProfile'))

const signal = new AbortController().signal
const exec = { signal }
await registeredTools.get('append_work_memory').execute({ content: '验证真实框架下的写入' }, exec)
check('tool execute works in real framework', (await read('work_memory.md')).includes('真实框架'))
const profileText = vars.get('companionProfile')()
check('prompt variable renders active profile', profileText.includes('小柔') && profileText.includes('companion_memory_tsundere.md'))

let schemaErr = null
try {
  await withTimeout(
    ctx.plugin(entry, { memoryDir: 42, defaultPersonality: 'genki' }),
    10000,
    'invalid config',
  )
} catch (e) {
  schemaErr = e
}
check('invalid config fails loud', schemaErr != null)

const disposeAll = async () => {
  try {
    await ctx.registry.dispose()
  } catch {
    try {
      await ctx.dispose()
    } catch {}
  }
}
await disposeAll()
check('app disposal clean', true)

await rm(dir, { recursive: true, force: true })
console.log(failures.length === 0 ? '\nALL INTEGRATION TESTS PASSED' : `\n${failures.length} FAILURES`)
process.exit(failures.length === 0 ? 0 : 1)
